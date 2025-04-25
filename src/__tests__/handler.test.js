const { appointmentScheduler } = require('../handler');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

// Mock DynamoDB
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn().mockReturnThis(),
        send: jest.fn()
    },
    PutCommand: jest.fn(),
    QueryCommand: jest.fn()
}));

describe('Appointment Scheduler', () => {
    const validEvent = {
        headers: {
            authorization: 'Bearer test-api-key'
        },
        body: JSON.stringify({
            fullName: "Test User",
            location: "Farrish Subaru",
            appointmentTime: "2025-04-27T15:30:00Z",
            car: "Subaru Outback",
            services: ["Oil Change"]
        })
    };

    beforeEach(() => {
        process.env.API_KEY = 'test-api-key';
        process.env.APPOINTMENTS_TABLE = 'test-table';
        jest.clearAllMocks();
        DynamoDBDocumentClient.send.mockResolvedValue({ Items: [] });
    });

    test('should successfully create appointment', async () => {
        const response = await appointmentScheduler(validEvent);
        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toHaveProperty('appointmentId');
    });

    test('should reject missing authorization header', async () => {
        const event = { ...validEvent, headers: {} };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(401);
    });

    test('should reject invalid API key', async () => {
        const event = {
            headers: { authorization: 'Bearer wrong-key' },
            body: validEvent.body
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(403);
    });

    test('should reject missing required fields', async () => {
        const event = {
            headers: validEvent.headers,
            body: JSON.stringify({
                fullName: "Test User",
                // missing location
                appointmentTime: "2025-04-27T15:30:00Z",
                car: "Subaru Outback",
                services: ["Oil Change"]
            })
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(400);
    });

    test('should reject past appointment times', async () => {
        const event = {
            headers: validEvent.headers,
            body: JSON.stringify({
                ...JSON.parse(validEvent.body),
                appointmentTime: "2020-04-27T15:30:00Z"
            })
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(400);
    });

    test('should reject non-business hours', async () => {
        const event = {
            headers: validEvent.headers,
            body: JSON.stringify({
                ...JSON.parse(validEvent.body),
                // Using 03:30:00Z (which is 11:30 PM previous day in EST)
                appointmentTime: "2025-04-27T03:30:00Z"
            })
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(400);
    });

    test('should reject conflicting appointments', async () => {
        DynamoDBDocumentClient.send.mockResolvedValueOnce({ Items: [{ appointmentId: 'existing' }] });
        const response = await appointmentScheduler(validEvent);
        expect(response.statusCode).toBe(409);
    });

    test('should handle DynamoDB errors', async () => {
        DynamoDBDocumentClient.send.mockRejectedValueOnce(new Error('DB Error'));
        const response = await appointmentScheduler(validEvent);
        expect(response.statusCode).toBe(500);
    });

    test('should reject appointments not on 30-minute intervals', async () => {
        const event = {
            headers: validEvent.headers,
            body: JSON.stringify({
                ...JSON.parse(validEvent.body),
                appointmentTime: "2025-04-27T15:45:00Z"  // 45 minutes past the hour
            })
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).message).toBe('Appointments must be scheduled on 30-minute intervals');
    });

    test('should reject empty services array', async () => {
        const event = {
            headers: validEvent.headers,
            body: JSON.stringify({
                ...JSON.parse(validEvent.body),
                services: []
            })
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).message).toBe('Services array cannot be empty');
    });

    test('should reject services array with empty strings', async () => {
        const event = {
            headers: validEvent.headers,
            body: JSON.stringify({
                ...JSON.parse(validEvent.body),
                services: ["Oil Change", ""]  // Empty string in services
            })
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).message).toBe('Services cannot contain empty values');
    });

    test('should reject services array with whitespace-only strings', async () => {
        const event = {
            headers: validEvent.headers,
            body: JSON.stringify({
                ...JSON.parse(validEvent.body),
                services: ["Oil Change", "   "]  // Whitespace-only string
            })
        };
        const response = await appointmentScheduler(event);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body).message).toBe('Services cannot contain empty values');
    });
}); 