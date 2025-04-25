# Appointment Scheduler API

This is a serverless application for scheduling appointments. It provides an API endpoint to create appointments with validation for business hours, time slots, and appointment conflicts.

## Prerequisites

- Node.js (v14 or later)
- AWS Account and AWS CLI configured
- Serverless Framework installed (`npm install -g serverless`)

## Deployment

1. Install dependencies:
```bash
npm install
```

2. Configure your environment variables in `serverless.yml`:
```yaml
environment:
  API_KEY: your-api-key-here
  APPOINTMENTS_TABLE: your-table-name
```

3. Deploy to AWS:
```bash
serverless deploy
```

After deployment, you'll receive an API endpoint URL. Save this URL for making requests.

## API Documentation

### Create Appointment

**Endpoint:** POST /appointments

**Headers:**
- `Authorization: Bearer your-api-key`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "fullName": "John Doe",
  "location": "Farrish Subaru",
  "appointmentTime": "2025-04-27T15:30:00Z",
  "car": "Subaru Outback",
  "services": ["Oil Change"]
}
```

**Sample CURL Request:**
```bash
curl -X POST https://your-api-endpoint/appointments \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Doe",
    "location": "Farrish Subaru",
    "appointmentTime": "2025-04-27T15:30:00Z",
    "car": "Subaru Outback",
    "services": ["Oil Change"]
  }'
```

**Validation Rules:**
- Appointments must be scheduled for future dates
- Appointments must be on 30-minute intervals
- Appointments must be during business hours
- Services array cannot be empty
- No conflicting appointments allowed at the same time

**Response Codes:**
- 201: Appointment created successfully
- 400: Invalid request (missing/invalid fields)
- 401: Missing authorization header
- 403: Invalid API key
- 409: Conflicting appointment exists
- 500: Server error

## Running Tests

1. Install development dependencies:
```bash
npm install
```

2. Run the test suite:
```bash
npm test
```

The test suite includes comprehensive tests for:
- Successful appointment creation
- Authentication and authorization
- Input validation
- Business rules validation
- Error handling
- Appointment conflict checking

## Development

The application uses:
- AWS Lambda for serverless compute
- DynamoDB for appointment storage
- Jest for testing
- Serverless Framework for deployment

## Environment Variables

- `API_KEY`: Authentication key for the API
- `APPOINTMENTS_TABLE`: DynamoDB table name for storing appointments 