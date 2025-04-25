'use strict';
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(client);

const isValidAppointmentTime = (appointmentTime) => {
    const appointmentDate = new Date(appointmentTime);
    const now = new Date();
    
    // Convert to EST/EDT
    const estDate = new Date(appointmentDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    // Check if appointment is in the past
    if (appointmentDate <= now) {
        return { valid: false, message: 'Appointment cannot be in the past' };
    }
    
    // Check if appointment is between 9 AM and 7 PM EST
    const hours = estDate.getHours();
    const minutes = estDate.getMinutes();
    
    if (hours < 9 || hours >= 19) {
        return { valid: false, message: 'Appointments must be between 9 AM and 7 PM EST' };
    }
    
    // Check if appointment is on 30-minute intervals
    if (minutes % 30 !== 0) {
        return { valid: false, message: 'Appointments must be scheduled on 30-minute intervals' };
    }
    
    return { valid: true };
};

const checkForConflicts = async (location, appointmentTime, tableName) => {
    // Check for appointments within the same 30-minute slot
    const appointmentDate = new Date(appointmentTime);
    const startTime = new Date(appointmentDate.getTime() - 15 * 60000); // 15 minutes before
    const endTime = new Date(appointmentDate.getTime() + 15 * 60000);   // 15 minutes after

    const params = {
        TableName: tableName,
        IndexName: 'locationTime',
        KeyConditionExpression: 'locationId = :loc AND appointmentDateTime BETWEEN :start AND :end',
        ExpressionAttributeValues: {
            ':loc': location,
            ':start': startTime.toISOString(),
            ':end': endTime.toISOString()
        }
    };

    const result = await dynamoDb.send(new QueryCommand(params));
    return result.Items && result.Items.length > 0;
};

const isValidServices = (services) => {
    if (!Array.isArray(services) || services.length === 0) {
        return { valid: false, message: 'Services array cannot be empty' };
    }
    
    // Check if any service is empty string
    if (services.some(service => !service || service.trim() === '')) {
        return { valid: false, message: 'Services cannot contain empty values' };
    }
    
    return { valid: true };
};

module.exports.appointmentScheduler = async (event) => {
    console.log('🔄 [START] Processing new appointment request');
    
    try {
        // Check Authorization header
        const authHeader = event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('🔐 [401] Authentication failed: Missing Authorization header');
            return {
                statusCode: 401,
                body: JSON.stringify({
                    message: 'Missing Authorization header'
                })
            };
        }

        const token = authHeader.split(' ')[1];
        if (token !== process.env.API_KEY) {
            console.log('🔐 [403] Authentication failed: Invalid API key');
            return {
                statusCode: 403,
                body: JSON.stringify({
                    message: 'Invalid API key'
                })
            };
        }

        const body = JSON.parse(event.body);
        console.log('📝 Request body:', JSON.stringify(body, null, 2));
        
        const { fullName, location, appointmentTime, car, services } = body;
        
        // Input validation
        if (!fullName || !location || !appointmentTime || !car) {
            console.log('🚫 [400] Validation failed - Missing required fields:', { fullName, location, appointmentTime, car });
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'Missing required fields'
                })
            };
        }

        // Validate services
        const servicesValidation = isValidServices(services);
        if (!servicesValidation.valid) {
            console.log('🚫 [400] Validation failed - Services validation:', servicesValidation.message);
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: servicesValidation.message
                })
            };
        }

        // Validate appointment time
        const timeValidation = isValidAppointmentTime(appointmentTime);
        if (!timeValidation.valid) {
            console.log('🚫 [400] Validation failed - Time validation:', timeValidation.message);
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: timeValidation.message
                })
            };
        }

        // Check for conflicts
        const hasConflict = await checkForConflicts(location, appointmentTime, process.env.APPOINTMENTS_TABLE);
        if (hasConflict) {
            console.log('⚠️ [409] Conflict: Time slot already booked');
            return {
                statusCode: 409,
                body: JSON.stringify({
                    message: 'This time slot is already booked'
                })
            };
        }

        // Create appointment record
        const timestamp = new Date().getTime();
        const appointment = {
            appointmentId: `appt_${timestamp}`,
            customerName: fullName,
            locationId: location,
            appointmentDateTime: appointmentTime,
            vehicleDetails: car,
            servicesList: services,
            status: 'SCHEDULED',
            createdAt: timestamp,
            updatedAt: timestamp
        };
        
        console.log('💾 Attempting to save appointment:', JSON.stringify(appointment, null, 2));

        await dynamoDb.send(new PutCommand({
            TableName: process.env.APPOINTMENTS_TABLE,
            Item: appointment
        }));
        
        console.log('✅ [201] Appointment successfully created');
        return {
            statusCode: 201,
            body: JSON.stringify(appointment)
        };
    } catch (error) {
        console.error('❌ [500] Error processing appointment:', {
            message: error.message,
            stack: error.stack,
            eventBody: event.body
        });
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Could not create the appointment',
                error: error.message
            })
        };
    }
};
