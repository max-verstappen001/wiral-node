import { google } from 'googleapis';
import logger from '../utils/logger.js';

class GoogleCalendarService {
    constructor() {
        this.calendar = null;
        this.initializeCalendar();
    }

    async initializeCalendar() {
        try {
            // Initialize Google Auth
            const auth = new google.auth.GoogleAuth({
                keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './config/google-service-account.json',
                scopes: ['https://www.googleapis.com/auth/calendar'],
            });

            // Create calendar instance
            this.calendar = google.calendar({ version: 'v3', auth });
            logger.info('Google Calendar service initialized successfully');
        } catch (error) {
            logger.warn('Google Calendar service initialization failed (will continue without calendar integration):', error.message);
            this.calendar = null;
        }
    }

    async bookPickupAppointment({
        customerName,
        customerPhone,
        pickupDate,
        pickupTime,
        pickupAddress,
        serviceType,
        notes,
        conversationId
    }) {
        try {
            if (!this.calendar) {
                logger.info('Google Calendar not configured - skipping calendar booking');
                return {
                    success: false,
                    error: 'Google Calendar not configured',
                    skipped: true
                };
            }

            // Parse date and time
            const startDateTime = this.parseDateTime(pickupDate, pickupTime);
            const endDateTime = new Date(startDateTime.getTime() + (60 * 60 * 1000)); // 1 hour appointment

            // Create event object
            const event = {
                summary: `Pickup - ${customerName} (${serviceType || 'Service'})`,
                description: this.buildEventDescription({
                    customerName,
                    customerPhone,
                    pickupAddress,
                    serviceType,
                    notes,
                    conversationId
                }),
                start: {
                    dateTime: startDateTime.toISOString(),
                    timeZone: process.env.TIMEZONE || 'UTC',
                },
                end: {
                    dateTime: endDateTime.toISOString(),
                    timeZone: process.env.TIMEZONE || 'UTC',
                },
                location: pickupAddress,
                attendees: [], // No email collection - appointments are internal only
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 60 }, // 1 hour before (popup only since no email)
                    ],
                },
            };

            // Insert event into calendar
            const calendarId = "11c9b4e1b9e78db0f5378689c972a0d7f2ef281f05af5356bfdebd64e61b22af@group.calendar.google.com";
            const response = await this.calendar.events.insert({
                calendarId: calendarId,
                resource: event,
            });

            logger.info(`Pickup appointment booked successfully: ${response.data.id}`);
            return {
                success: true,
                eventId: response.data.id,
                eventLink: response.data.htmlLink,
                startTime: startDateTime,
                endTime: endDateTime
            };

        } catch (error) {
            logger.error('Error booking pickup appointment:', error);
            logger.error('Booking details that failed:', {
                customerName,
                customerPhone,
                pickupDate,
                pickupTime
            });
            return {
                success: false,
                error: error.message
            };
        }
    }

    parseDateTime(dateStr, timeStr) {
        try {
            let date = new Date();
            const currentYear = new Date().getFullYear();
            
            // Normalize common abbreviations first
            const normalizedDateStr = dateStr.toLowerCase()
                .replace(/\b(tmrw|tmr|2morrow)\b/g, 'tomorrow')
                .replace(/\b(tdy)\b/g, 'today');
            
            // Handle relative dates
            if (normalizedDateStr.includes('today')) {
                date = new Date();
            } else if (normalizedDateStr.includes('tomorrow')) {
                date = new Date();
                date.setDate(date.getDate() + 1);
            } else if (dateStr && dateStr !== 'Not specified') {
                // Try parsing the date - if no year specified, it defaults to current year
                const parsedDate = new Date(dateStr + ` ${currentYear}`);
                if (!isNaN(parsedDate.getTime())) {
                    date = parsedDate;
                } else {
                    // If parsing fails, try without adding year
                    const fallbackDate = new Date(dateStr);
                    if (!isNaN(fallbackDate.getTime()) && fallbackDate.getFullYear() >= currentYear) {
                        date = fallbackDate;
                    }
                    // Otherwise keep default (today)
                }
            }

            // Parse and set time
            if (timeStr && timeStr !== 'Not specified') {
                const timeMatch = timeStr.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
                if (timeMatch) {
                    let hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2] || '0');
                    const ampm = timeMatch[3]?.toLowerCase();

                    if (ampm === 'pm' && hours !== 12) hours += 12;
                    if (ampm === 'am' && hours === 12) hours = 0;

                    date.setHours(hours, minutes, 0, 0);
                }
            }

            return date;

        } catch (error) {
            logger.error('Error parsing date/time:', error);
            // Return next hour as fallback
            const fallback = new Date();
            fallback.setHours(fallback.getHours() + 1, 0, 0, 0);
            return fallback;
        }
    }

    buildEventDescription({
        customerName,
        customerPhone,
        pickupAddress,
        serviceType,
        notes,
        conversationId
    }) {
        return `
Pickup Appointment Details:

Customer Information:
• Name: ${customerName || 'Not provided'}
• Phone: ${customerPhone || 'Not provided'}

Service Details:
• Service Type: ${serviceType || 'Not specified'}
• Pickup Address: ${pickupAddress || 'Not provided'}

Additional Notes:
${notes || 'None'}

Conversation ID: ${conversationId}
        `.trim();
    }

    async updateAppointment(eventId, updates) {
        try {
            if (!this.calendar) {
                throw new Error('Google Calendar not initialized');
            }

            const calendarId = "11c9b4e1b9e78db0f5378689c972a0d7f2ef281f05af5356bfdebd64e61b22af@group.calendar.google.com";
            
            // Get existing event
            const existingEvent = await this.calendar.events.get({
                calendarId: calendarId,
                eventId: eventId,
            });

            // Merge updates
            const updatedEvent = {
                ...existingEvent.data,
                ...updates
            };

            // Update event
            const response = await this.calendar.events.update({
                calendarId: calendarId,
                eventId: eventId,
                resource: updatedEvent,
            });

            logger.info(`Appointment updated successfully: ${eventId}`);
            return {
                success: true,
                eventId: response.data.id,
                eventLink: response.data.htmlLink
            };

        } catch (error) {
            logger.error('Error updating appointment:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async cancelAppointment(eventId) {
        try {
            if (!this.calendar) {
                throw new Error('Google Calendar not initialized');
            }

            const calendarId = "11c9b4e1b9e78db0f5378689c972a0d7f2ef281f05af5356bfdebd64e61b22af@group.calendar.google.com";
            
            await this.calendar.events.delete({
                calendarId: calendarId,
                eventId: eventId,
            });

            logger.info(`Appointment cancelled successfully: ${eventId}`);
            return { success: true };

        } catch (error) {
            logger.error('Error cancelling appointment:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export default GoogleCalendarService;
