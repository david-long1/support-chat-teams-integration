# Support Chat Teams Integration

A Flask-based application that bridges your customer support chat with Microsoft Teams, allowing support agents to handle customer inquiries directly from Teams.

## Features

- Real-time chat via WebSockets
- Integration with Microsoft Teams using Graph API
- Automated creation of Teams chats for support requests
- Support for authentication via device code flow
- Persistent chat history

## Setup

1. Clone this repository
2. Create a `.env` file based on `.env.example`
3. Install dependencies: `pip install -r requirements.txt`
4. Run the application: `python app.py`

## Configuration

You'll need to register an application in Azure AD and configure the appropriate permissions.
