'use strict';

// 1. Import the DynamoDB client and commands using require
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

// --- Client Configuration ---
// Check if running offline (serverless-offline sets this env var)
const IS_OFFLINE = process.env.IS_OFFLINE === 'true';

const dynamoDbClientOptions = {};

if (IS_OFFLINE) {
  console.log('Running offline - configuring DynamoDB client for local');
  dynamoDbClientOptions.region = 'localhost'; // Keep a dummy region
  dynamoDbClientOptions.credentials = {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy',
  };

  // Explicitly set the endpoint for offline use
  // Point to the standard local DynamoDB port (should match serverless.yml)
  dynamoDbClientOptions.endpoint = 'http://localhost:8000';
  console.log(`Offline endpoint configured: ${dynamoDbClientOptions.endpoint}`);
}
// If not offline (i.e., deployed to AWS Lambda), dynamoDbClientOptions remains empty {},
// and the SDK will automatically use the Lambda execution role's credentials and region.

// Initialize the DynamoDB Client with specific options if offline
const client = new DynamoDBClient(dynamoDbClientOptions);
const docClient = DynamoDBDocumentClient.from(client);
// --- End Client Configuration ---

// 3. Get the table name from environment variables
let tableName = process.env.APPOINTMENTS_TABLE_NAME;

// If running locally or the table name is not a valid string
if (IS_OFFLINE || !tableName || tableName === 'undefined' || tableName === '') {
  tableName = 'AppointmentsTable';
}

// Add detailed logging
console.log('DEBUG - Environment variables:');
console.log('APPOINTMENTS_TABLE_NAME:', process.env.APPOINTMENTS_TABLE_NAME);
console.log('IS_OFFLINE:', IS_OFFLINE);

console.log('Final table name being used:', tableName);

// Add this function before your schedule function
async function checkForExistingAppointment(location, appointmentTime) {
  // Use a scan operation with filters instead of a query
  const params = {
    TableName: tableName,
    FilterExpression: "#loc = :loc AND appointmentTime = :time",
    ExpressionAttributeNames: {
      "#loc": "location"  // Use expression attribute name for reserved keyword
    },
    ExpressionAttributeValues: {
      ":loc": location,
      ":time": appointmentTime
    }
  };
  
  try {
    const { Items } = await docClient.send(new ScanCommand(params));
    return Items && Items.length > 0;
  } catch (error) {
    console.error("Error checking for existing appointments:", error);
    throw error;
  }
}

// Helper function to validate the API key
function validateApiKey(event) {
  console.log('--- Inside validateApiKey ---');
  console.log('Received headers:', JSON.stringify(event.headers, null, 2));
  const apiKey = process.env.API_KEY;
  console.log('Value of process.env.API_KEY:', apiKey);

  if (!apiKey) {
    // Should not happen if deployed correctly, but good practice
    console.error('API_KEY environment variable is not set.');
    return { valid: false, response: { statusCode: 500, body: JSON.stringify({ message: 'Internal Server Error: API Key not configured.' }) } };
  }

  // Check for both 'Authorization' (common from clients) and 'authorization' (common from API Gateway)
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  console.log('Found authHeader:', authHeader);

  if (!authHeader) {
    console.log('Authorization header missing check -> TRUE');
    return { valid: false, response: { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) } };
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  console.log('Extracted token:', token);

  if (!token) {
    console.log('Bearer token missing or malformed check -> TRUE');
    // Treat malformed header as Unauthorized
    return { valid: false, response: { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized' }) } };
  }

  if (token !== apiKey) {
    console.log(`Invalid API key provided check -> TRUE (token: ${token}, apiKey: ${apiKey})`);
    // Return 403 Forbidden for an invalid key
    return { valid: false, response: { statusCode: 403, body: JSON.stringify({ message: 'Forbidden' }) } };
  }

  console.log('API key validated successfully.');
  return { valid: true, response: null };
}

// This is the function that will be executed by AWS Lambda
module.exports.schedule = async (event) => {
  console.log('--- Handler Invoked ---');
  console.log('Received raw event:', JSON.stringify(event, null, 2));
  try {
    // 1. Validate API Key
    const apiKeyValidation = validateApiKey(event);
    if (!apiKeyValidation.valid) {
      console.log('API Key validation failed, returning response.');
      return apiKeyValidation.response; // Return 401 or 403 based on validation
    }

    console.log('API Key validation passed. Proceeding...');

    console.log('Received event:', JSON.stringify(event, null, 2)); // Log the incoming event for debugging

    let requestBody;
    try {
      // Parse the incoming request body string into a JavaScript object
      requestBody = JSON.parse(event.body || '{}'); // Use || '{}' to handle empty body gracefully
      console.log('Parsed request body:', requestBody);

      // 1. Validate the request body
      if (!requestBody.fullName || !requestBody.location || !requestBody.appointmentTime || !requestBody.car || !requestBody.services) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: 'Missing required fields. Please provide fullName, location, appointmentTime, car, and services.'
          })
        };
      }

      // 2. Validate appointment time format and business rules
      const timestamp = Date.parse(requestBody.appointmentTime);
      if (isNaN(timestamp)) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: 'Invalid appointmentTime format. Please provide a valid ISO 8601 date string.'
          })
        };
      }

      const appointmentDate = new Date(timestamp);
      const now = new Date();

      // Check if appointment is in the future
      if (appointmentDate <= now) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: 'Appointment time must be in the future.'
          })
        };
      }

      // Check if appointment is during business hours (9 AM to 6 PM)
      const hours = appointmentDate.getUTCHours();
      const minutes = appointmentDate.getUTCMinutes();

      if (hours < 9 || hours > 18 || (hours === 18 && minutes > 0)) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: 'Appointments must be scheduled between 9 AM and 6 PM.'
          })
        };
      }

      // Check if appointment is on a 30-minute interval (0 or 30 minutes)
      if (minutes !== 0 && minutes !== 30) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: 'Appointments must be scheduled on the hour or half-hour (e.g., 9:00 AM, 9:30 AM).'
          })
        };
      }

      console.log('Input validation passed.');
    } catch (error) {
      console.error('Could not parse request body:', error);
      return {
        statusCode: 400, // Bad Request
        body: JSON.stringify({ message: 'Invalid JSON format in request body.' }),
      };
    }

    // Check if the appointment slot is already booked
    const hasExistingAppointment = await checkForExistingAppointment(requestBody.location, requestBody.appointmentTime);
    if (hasExistingAppointment) {
      return {
        statusCode: 409, // Conflict status code
        body: JSON.stringify({
          message: "This appointment slot is already booked. Please select a different time or location."
        })
      };
    }

    // 4. Prepare the item to save to DynamoDB
    const itemToSave = {
      location: requestBody.location,             // Partition Key
      appointmentTime: requestBody.appointmentTime, // Sort Key
      fullName: requestBody.fullName,
      car: requestBody.car,                       // Optional car info
      services: requestBody.services,
      createdAt: new Date().toISOString(), // Add a timestamp for when it was created
    };

    // 5. Create the PutCommand parameters
    const params = {
      TableName: tableName,
      Item: itemToSave,
    };

    // 6. Try saving the item to DynamoDB
    try {
      console.log(`Attempting to save item to DynamoDB table: ${tableName}`, itemToSave);
      await docClient.send(new PutCommand(params));
      console.log('Successfully saved item to DynamoDB');

      // 7. Return success response
      return {
        statusCode: 200, // 201 Created is often more appropriate for successful resource creation
        body: JSON.stringify(
          {
            message: 'Appointment scheduled successfully!',
            appointmentDetails: itemToSave, // Return the saved item details
          },
          null,
          2
        ),
      };
    } catch (error) {
      // 8. Handle DynamoDB errors
      console.error('Error saving to DynamoDB:', error);
      return {
        statusCode: 500, // Internal Server Error
        body: JSON.stringify({
          message: 'Failed to schedule appointment due to a server error.',
          error: error.message, // Include error message for debugging (consider removing in production)
        }),
      };
    }
  } catch (error) {
    console.error('Error in schedule function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to schedule appointment due to a server error.',
        error: error.message,
      }),
    };
  }
};

// You could add other handlers here for different endpoints if needed
// module.exports.getAppointment = async (event) => { ... };