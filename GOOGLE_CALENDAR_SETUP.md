# Google Calendar Integration Setup

## Required Environment Variables

Add these variables to your `.env` file:

```env
# Google Calendar Configuration
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./config/google-service-account.json
GOOGLE_CALENDAR_ID=primary
TIMEZONE=UTC

# Optional: Specific calendar ID if not using primary
# GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com
```

## Google Service Account Setup

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one

2. **Enable Google Calendar API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

3. **Create Service Account**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in service account details
   - Click "Create and Continue"

4. **Generate Private Key**
   - In the service account list, click on your newly created account
   - Go to "Keys" tab
   - Click "Add Key" > "Create New Key"
   - Choose "JSON" format
   - Download the JSON file

5. **Configure the JSON File**
   - Save the downloaded JSON file as `config/google-service-account.json`
   - Or update the `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` environment variable to point to your file

6. **Share Calendar with Service Account**
   - Open Google Calendar
   - Go to calendar settings (gear icon > Settings)
   - Select the calendar you want to use
   - In "Share with specific people", add your service account email
   - Give it "Make changes to events" permission

## Testing

The system will automatically:
- Detect when customers want to schedule pickups
- Extract date, time, and location details
- Book appointments in Google Calendar
- Send confirmation messages
- Add "scheduled" tags to conversations
- Store calendar event IDs as custom attributes

## Troubleshooting

- Ensure service account has calendar access
- Check that the JSON file path is correct
- Verify the calendar ID (use 'primary' for main calendar)
- Check Google Cloud Console for API quotas and errors
