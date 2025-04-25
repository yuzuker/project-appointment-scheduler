// Import the modules to test
const { schedule } = require('../src/handler');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Mock the AWS SDK
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({
        send: mockSend
      })
    },
    PutCommand: jest.fn(),
    ScanCommand: jest.fn()
  };
});

// Mock environment variables
process.env.APPOINTMENTS_TABLE_NAME = 'AppointmentsTable';
process.env.API_KEY = 'test-api-key';
process.env.IS_OFFLINE = 'true';

describe('Appointment Scheduling API', () => {
  let mockSend;
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockSend = DynamoDBDocumentClient.from().send;
    
    // Default behavior for ScanCommand (no existing appointments)
    mockSend.mockImplementation((command) => {
      if (command instanceof ScanCommand) {
        return Promise.resolve({ Items: [] });
      }
      return Promise.resolve({});
    });
  });
  
  describe('schedule function', () => {
    test('should return 401 when API key is missing', async () => {
      // Arrange
      const event = {
        headers: {},
        body: JSON.stringify({
          fullName: 'Test User',
          location: 'Test Location',
          appointmentTime: '2025-04-26T12:30:00Z',
          car: 'Test Car',
          services: ['Test Service']
        })
      };
      
      // Act
      const response = await schedule(event);
      
      // Assert
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).message).toContain('Unauthorized');
    });
    
    test('should return 403 when API key is invalid', async () => {
      // Arrange
      const event = {
        headers: {
          Authorization: 'Bearer wrong-api-key'
        },
        body: JSON.stringify({
          fullName: 'Test User',
          location: 'Test Location',
          appointmentTime: '2025-04-26T12:30:00Z',
          car: 'Test Car',
          services: ['Test Service']
        })
      };
      
      // Act
      const response = await schedule(event);
      
      // Assert
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).message).toContain('Forbidden');
    });
    
    test('should return 400 when required fields are missing', async () => {
      // Arrange
      const event = {
        headers: {
          Authorization: 'Bearer test-api-key'
        },
        body: JSON.stringify({
          // Missing required fields
          fullName: 'Test User'
        })
      };
      
      // Act
      const response = await schedule(event);
      
      // Assert
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).message).toContain('Missing required fields');
    });
    
    test('should return 400 when appointment time is invalid', async () => {
      // Arrange
      const event = {
        headers: {
          Authorization: 'Bearer test-api-key'
        },
        body: JSON.stringify({
          fullName: 'Test User',
          location: 'Test Location',
          appointmentTime: 'invalid-date',
          car: 'Test Car',
          services: ['Test Service']
        })
      };
      
      // Act
      const response = await schedule(event);
      
      // Assert
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).message).toContain('Invalid appointmentTime');
    });
    
    test('should return 400 when appointment time is not on a 30-minute interval', async () => {
      // Arrange
      const event = {
        headers: {
          Authorization: 'Bearer test-api-key'
        },
        body: JSON.stringify({
          fullName: 'Test User',
          location: 'Test Location',
          appointmentTime: '2025-04-26T12:15:00Z', // 12:15 is not on a 30-minute interval
          car: 'Test Car',
          services: ['Test Service']
        })
      };
      
      // Act
      const response = await schedule(event);
      
      // Assert
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).message).toContain('half-hour');
    });
    
    test('should return 409 when appointment slot is already booked', async () => {
      // Arrange
      const event = {
        headers: {
          Authorization: 'Bearer test-api-key'
        },
        body: JSON.stringify({
          fullName: 'Test User',
          location: 'Test Location',
          appointmentTime: '2025-04-26T12:30:00Z',
          car: 'Test Car',
          services: ['Test Service']
        })
      };
      
      // Mock that an appointment already exists
      mockSend.mockImplementation((command) => {
        if (command instanceof ScanCommand) {
          return Promise.resolve({ 
            Items: [{ 
              fullName: 'Existing User',
              location: 'Test Location',
              appointmentTime: '2025-04-26T12:30:00Z'
            }] 
          });
        }
        return Promise.resolve({});
      });
      
      // Act
      const response = await schedule(event);
      
      // Assert
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).message).toContain('already booked');
    });
    
    test('should successfully schedule an appointment', async () => {
      // Arrange
      const event = {
        headers: {
          Authorization: 'Bearer test-api-key'
        },
        body: JSON.stringify({
          fullName: 'Test User',
          location: 'Test Location',
          appointmentTime: '2025-04-26T12:30:00Z',
          car: 'Test Car',
          services: ['Test Service']
        })
      };
      
      // Act
      const response = await schedule(event);
      
      // Assert
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).message).toContain('successfully');
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutCommand));
    });
  });
}); 