require('dotenv').config();
const axios = require('axios');

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

if (!API_URL) {
    throw new Error('API_URL environment variable is not set');
}

describe('Appointment Scheduler E2E Tests', () => {
    let createdAppointmentId;

    // Calculate a valid future appointment time (next business day at 2 PM EST)
    const getValidAppointmentTime = () => {
        const date = new Date();
        date.setDate(date.getDate() + 1);  // tomorrow
        date.setHours(14, 0, 0, 0);  // 2 PM
        return date.toISOString().split('.')[0] + 'Z';
    };

    const validAppointment = {
        fullName: "E2E Test User",
        location: "Farrish Subaru",
        appointmentTime: getValidAppointmentTime(),
        car: "Subaru Outback",
        services: ["Oil Change"]
    };

    const headers = {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    };

    test('should create and delete an appointment', async () => {
        try {
            // Create appointment
            const createResponse = await axios.post(
                `${API_URL}/appointments`,
                validAppointment,
                { headers }
            );

            expect(createResponse.status).toBe(200);
            expect(createResponse.data).toHaveProperty('appointmentId');
            createdAppointmentId = createResponse.data.appointmentId;

            // Delete appointment
            const deleteResponse = await axios.delete(
                `${API_URL}/appointments/${createdAppointmentId}`,
                { headers }
            );

            expect(deleteResponse.status).toBe(200);
        } catch (error) {
            console.error('Test failed with error:', {
                message: error.message,
                response: error.response?.data
            });
            throw error;
        }
    }, 10000);

    test('should fail with invalid API key', async () => {
        expect.assertions(1);
        const invalidHeaders = {
            'Authorization': 'Bearer invalid-key',
            'Content-Type': 'application/json'
        };

        try {
            await axios.post(
                `${API_URL}/appointments`,
                validAppointment,
                { headers: invalidHeaders }
            );
            throw new Error('Expected request to fail');
        } catch (error) {
            expect(error.response.status).toBe(403);
        }
    });

    test('should fail with missing required fields', async () => {
        expect.assertions(1);
        const invalidAppointment = { ...validAppointment, fullName: '' };
        try {
            await axios.post(
                `${API_URL}/appointments`,
                invalidAppointment,
                { headers }
            );
            throw new Error('Expected request to fail');
        } catch (error) {
            expect(error.response.status).toBe(400);
        }
    });

    test('should fail with non-business hours appointment', async () => {
        expect.assertions(1);
        const date = new Date();
        date.setDate(date.getDate() + 1);
        date.setHours(22, 0, 0, 0); // 10 PM

        const invalidAppointment = {
            ...validAppointment,
            appointmentTime: date.toISOString().split('.')[0] + 'Z'
        };

        try {
            await axios.post(
                `${API_URL}/appointments`,
                invalidAppointment,
                { headers }
            );
            throw new Error('Expected request to fail');
        } catch (error) {
            expect(error.response.status).toBe(400);
        }
    });

    test('should fail with non-30-minute interval appointment', async () => {
        expect.assertions(1);
        const date = new Date();
        date.setDate(date.getDate() + 1);
        date.setHours(14, 45, 0, 0); // 2:45 PM

        const invalidAppointment = {
            ...validAppointment,
            appointmentTime: date.toISOString().split('.')[0] + 'Z'
        };

        try {
            await axios.post(
                `${API_URL}/appointments`,
                invalidAppointment,
                { headers }
            );
            throw new Error('Expected request to fail');
        } catch (error) {
            expect(error.response.status).toBe(400);
        }
    });

    test('should fail with empty services array', async () => {
        expect.assertions(1);
        const invalidAppointment = {
            ...validAppointment,
            services: []
        };

        try {
            await axios.post(
                `${API_URL}/appointments`,
                invalidAppointment,
                { headers }
            );
            throw new Error('Expected request to fail');
        } catch (error) {
            expect(error.response.status).toBe(400);
        }
    });


    test('should detect appointment conflicts', async () => {
        // Create first appointment
        const firstResponse = await axios.post(
            `${API_URL}/appointments`,
            validAppointment,
            { headers }
        );
        
        expect(firstResponse.status).toBe(200);
        const firstAppointmentId = firstResponse.data.appointmentId;

        // Try to create second appointment at same time
        try {
            expect.assertions(2);
            await axios.post(
                `${API_URL}/appointments`,
                validAppointment,
                { headers }
            );
            throw new Error('Expected request to fail');
        } catch (error) {
            expect(error.response.status).toBe(409);
        } finally {
            // Clean up the test appointment
            await axios.delete(
                `${API_URL}/appointments/${firstAppointmentId}`,
                { headers }
            );
        }
    });

    test('should fail when creating appointment outside business hours', async () => {
        expect.assertions(2);
        // Create an appointment for 8 PM EST (outside 9 AM - 7 PM EST window)
        const date = new Date();
        date.setDate(date.getDate() + 1);  // tomorrow
        date.setHours(20, 0, 0, 0);  // 8 PM EST

        const afterHoursAppointment = {
            ...validAppointment,
            appointmentTime: date.toISOString().split('.')[0] + 'Z'
        };

        try {
            await axios.post(
                `${API_URL}/appointments`,
                afterHoursAppointment,
                { headers }
            );
            throw new Error('Expected request to fail');
        } catch (error) {
            expect(error.response.status).toBe(400);
            expect(error.response.data.message).toBe('Appointments must be between 9 AM and 7 PM EST');
        }
    });


});
