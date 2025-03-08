"""
Support Chat Flask Backend

This Flask application serves as the backend for our support chat prototype.
It handles:
1. WebSocket connections for real-time communication
2. HTTP endpoints for submitting support requests
3. Forwarding requests to Power Automate via webhook
"""

import msal
import requests
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, join_room
import uuid
from datetime import datetime, timedelta
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
from flask_cors import CORS
from datetime import timezone

app = Flask(__name__)
CORS(app)  # Add this line to enable CORS for all routes
socketio = SocketIO(app, cors_allowed_origins="*")

import os
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env

# Use your existing configuration
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
TENANT_ID = os.getenv("TENANT_ID")
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]

# This will be the ID of your support team members
# You'll need to get the IDs of the support team members
# SUPPORT_TEAM_MEMBERS = [
#     # Format: {"@odata.type": "microsoft.graph.aadUserConversationMember", "userId": "user-id-here"}
#     {"@odata.type": "microsoft.graph.aadUserConversationMember", "userId": "b376ef58-43a1-4b28-b3f2-968e8f8af8fc"},
#     {"@odata.type": "microsoft.graph.aadUserConversationMember", "userId": "b376ef58-43a1-4b28-b3f2-968e8f8af8fc"}
# ]

# Store active support requests
active_requests = {}

def get_access_token():
    """
    Get an access token using application-only authentication (client credentials flow).
    This is good for most Graph API operations but won't work for sending Teams messages.
    """
    app = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET
    )
    
    result = app.acquire_token_for_client(scopes=SCOPE)
    
    if "access_token" in result:
        return result["access_token"]
    else:
        print(f"Error getting token: {result.get('error')}")
        print(f"Error description: {result.get('error_description')}")
        return None

import asyncio
from msgraph import GraphServiceClient
from msgraph.generated.models.chat_message import ChatMessage
from msgraph.generated.models.item_body import ItemBody
from azure.identity import UsernamePasswordCredential

def get_token_with_device_code():
    """
    Get an access token using device code flow.
    This requires user interaction once, but can save the refresh token for future use.
    """
    token_cache_file = "token_cache.json"
    
    # Create token cache on disk
    cache = msal.SerializableTokenCache()
    
    # Load the token cache from file if it exists
    if os.path.exists(token_cache_file):
        with open(token_cache_file, "r") as f:
            cache.deserialize(f.read())
            
    # Initialize MSAL app
    app = msal.PublicClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        token_cache=cache
    )
    
    # Try to find a token in cache first
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(
            ["https://graph.microsoft.com/.default"],
            account=accounts[0]
        )
        if "access_token" in result:
            print("Got token from cache")
            # Save cache for future use
            with open(token_cache_file, "w") as f:
                f.write(cache.serialize())
            return result["access_token"]
    
    # No suitable token in cache, we need to acquire a new one using device code flow
    flow = app.initiate_device_flow(scopes=["https://graph.microsoft.com/.default"])
    if "user_code" not in flow:
        print("Failed to create device flow")
        return None
    
    print(f"To sign in, use a web browser to open the page {flow['verification_uri']} and enter the code {flow['user_code']} to authenticate.")
    
    # This will block until user authenticates or times out
    result = app.acquire_token_by_device_flow(flow)
    
    if "access_token" in result:
        # Save cache for future use
        with open(token_cache_file, "w") as f:
            f.write(cache.serialize())
        return result["access_token"]
    else:
        print(f"Failed to get token: {result.get('error')}")
        print(f"Error description: {result.get('error_description')}")
        return None
    
def send_message_with_delegated_auth(chat_id, content):
    """
    Send a message to a Teams chat using delegated authentication.
    """
    try:
        # Get a delegated access token
        access_token = get_token_with_device_code()
        if not access_token:
            print("Failed to obtain delegated access token")
            return None
        
        # Prepare the message content
        message_content = {}
        if isinstance(content, dict) and "body" in content:
            message_content = content
        else:
            message_content = {
                "body": {
                    "contentType": "text",
                    "content": content
                }
            }
        
        # Send the message using a direct REST API call
        response = requests.post(
            f"https://graph.microsoft.com/v1.0/chats/{chat_id}/messages",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            },
            json=message_content
        )
        
        # Check if the message was sent successfully
        if response.status_code in (200, 201):
            message_data = response.json()
            message_id = message_data.get('id')
            print(f"Successfully sent message with ID: {message_id}")
            return message_data
        else:
            print(f"Error sending message: {response.status_code}")
            print(f"Response: {response.text}")
            return None

    except Exception as e:
        print(f"Error sending message: {str(e)}")
        import traceback
        traceback.print_exc()
        return None
    

@app.route('/api/message', methods=['POST'])
def send_followup_message():
    """
    Endpoint for sending follow-up messages in an existing support conversation.
    """
    # Get request data
    data = request.json
    request_id = data.get('requestId')
    user_message = data.get('message', '')
    
    if not request_id or not user_message:
        return jsonify({
            'success': False,
            'message': 'Missing requestId or message'
        }), 400
    
    # Check if this is an active request
    if request_id not in active_requests:
        return jsonify({
            'success': False,
            'message': 'Unknown request ID'
        }), 404
    
    # Get the Teams chat ID for this request
    chat_id = active_requests[request_id].get('teams_chat_id')
    if not chat_id:
        return jsonify({
            'success': False,
            'message': 'No Teams chat associated with this request'
        }), 400
    
    try:
        # Get user information
        user_name = active_requests[request_id].get('user_name', 'Anonymous User')
        
        # Create message content with a special format that we can detect later
        message_content = {
            "body": {
                "contentType": "html",
                "content": f"""
                    <p><strong>From {user_name}:</strong> {user_message}</p>
                    <!-- client_message_marker -->
                """
            }
        }
        
        # Send message to Teams chat using delegated auth
        message_result = send_message_with_delegated_auth(chat_id, message_content)
        
        if not message_result:
            return jsonify({
                'success': False,
                'message': 'Failed to send message to Teams'
            }), 500
        
        # Don't emit via WebSocket since we already have this message in the UI
        
        return jsonify({
            'success': True,
            'message': 'Message sent successfully'
        }), 200
        
    except Exception as e:
        print(f"Exception sending follow-up message: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            'success': False,
            'message': f'Error sending message: {str(e)}'
        }), 500


@app.route('/api/support', methods=['POST'])
def submit_support_request():
    """
    Endpoint for submitting a new support request.
    This will create a new group chat in Teams for this specific conversation.
    """
    # Get request data
    data = request.json
    user_message = data.get('message', '')
    user_name = data.get('userName', 'Anonymous User')
    user_email = data.get('userEmail', '')
    chat_history = data.get('chatHistory', '')
    
    print(f"Received support request from {user_name} ({user_email}): {user_message}")
    
    # Generate unique request ID
    request_id = str(uuid.uuid4())
    
    # Store request details
    timestamp = datetime.now().isoformat()
    active_requests[request_id] = {
        'user_name': user_name,
        'user_email': user_email,
        'message': user_message,
        'timestamp': timestamp,
        'status': 'pending'
    }
    
    try:
        # Get Microsoft Graph access token
        print("Attempting to get Microsoft Graph access token...")
        access_token = get_access_token()
        if not access_token:
            print("Failed to get Microsoft Graph access token")
            # Fall back to test mode
            send_test_response(request_id, user_message)
            return jsonify({
                'success': True,
                'requestId': request_id,
                'message': 'Support request submitted (fallback mode)'
            }), 200
        
        print("Successfully obtained access token")
        
        # Step 1: Create a new group chat - UPDATED FORMAT
        print("Attempting to create Teams chat...")
        
        # Convert SUPPORT_TEAM_MEMBERS to the proper format
        members = []
        for member in SUPPORT_TEAM_MEMBERS:
            user_id = member.get('userId')
            if user_id:
                members.append({
                    "@odata.type": "#microsoft.graph.aadUserConversationMember",
                    "roles": ["owner"],
                    "user@odata.bind": f"https://graph.microsoft.com/v1.0/users('{user_id}')"
                })
        
        chat_data = {
            "chatType": "group",
            "topic": f"Support Request from {user_name} - {request_id[:8]}",
            "members": members
        }
        
        print(f"Chat request data: {chat_data}")
        
        chat_response = requests.post(
            "https://graph.microsoft.com/v1.0/chats",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            },
            json=chat_data
        )
        
        print(f"Chat creation response status: {chat_response.status_code}")
        print(f"Chat creation response: {chat_response.text}")
        
        if chat_response.status_code not in (201, 200):
            print(f"Error creating chat: {chat_response.status_code}")
            print(f"Response: {chat_response.text}")
            # Fall back to test mode
            send_test_response(request_id, user_message)
            return jsonify({
                'success': True,
                'requestId': request_id,
                'message': 'Support request submitted (fallback mode - chat creation failed)'
            }), 200
        
        chat_info = chat_response.json()
        chat_id = chat_info['id']
        print(f"Successfully created chat with ID: {chat_id}")
        
        # Store the chat ID for future reference
        active_requests[request_id]['teams_chat_id'] = chat_id
        
        # Step 2: Send the initial message to the chat
        print("Sending initial message to Teams chat...")
        message_content = {
            "body": {
                "contentType": "html",
                "content": f"""
                    <h2>New Support Request</h2>
                    <p><strong>From:</strong> {user_name} ({user_email})</p>
                    <p><strong>Request ID:</strong> {request_id}</p>
                    <p><strong>Time:</strong> {timestamp}</p>
                    <hr>
                    <p><strong>Message:</strong></p>
                    <p>{user_message}</p>
                    <hr>
                    {f'<p><strong>Previous chatbot conversation:</strong></p><pre>{chat_history}</pre><hr>' if chat_history else ''}
                    <p>Reply to this message to respond directly to the user.</p>
                """
            }
        }

        message_result = send_message_with_delegated_auth(chat_id, message_content)
        
        # Handle the message result, whether it's a dictionary or an object
        if message_result:
            try:
                # Check if message_result is a dictionary or an object
                if isinstance(message_result, dict):
                    message_id = message_result.get('id')
                    print(f"Successfully sent message with ID: {message_id}")
                    if message_id:
                        active_requests[request_id]['initial_message_id'] = message_id
                else:
                    # Assuming it's an object with an id attribute
                    print(f"Successfully sent message with ID: {message_result.id}")
                    active_requests[request_id]['initial_message_id'] = message_result.id
            except Exception as e:
                print(f"Error processing message result: {str(e)}")
                # Continue with the function instead of jumping to fallback
        else:
            print("Failed to send message using Graph SDK")
            # We'll continue anyway since the chat was created
            chat_link = chat_info.get('webUrl')
            active_requests[request_id]['teams_chat_link'] = chat_link
        
        # Step 3: Create a subscription for messages in this chat
        print("Creating subscription for chat messages...")
        try:
            create_chat_subscription(request_id, chat_id)
        except Exception as subscription_error:
            print(f"Error creating subscription: {str(subscription_error)}")
            print("Continuing without subscription - webhook notifications will not work")
            # Continue anyway, as this is not critical for the initial flow
        
        return jsonify({
            'success': True,
            'requestId': request_id,
            'message': 'Support request submitted successfully'
        }), 200
            
    except Exception as e:
        print(f"Exception in support request: {str(e)}")
        import traceback
        traceback.print_exc()
        
        # Fall back to test mode
        send_test_response(request_id, user_message)
        return jsonify({
            'success': True,
            'requestId': request_id,
            'message': 'Support request submitted (fallback mode - exception)'
        }), 200

def send_test_response(request_id, user_message):
    """Send a test response for cases where Microsoft Graph API is unavailable"""
    def _send_response():
        print(f"Sending test response to request {request_id}")
        response_data = {
            'requestId': request_id,
            'message': f"This is a test response to: {user_message}",
            'responderName': 'Test Support Agent',
            'timestamp': datetime.now().isoformat()
        }
        socketio.emit('support_response', response_data, room=request_id)
    
    socketio.start_background_task(lambda: (socketio.sleep(2), _send_response()))

def create_chat_subscription(request_id, chat_id):
    """
    Create a subscription to receive notifications for new messages in a chat
    """
    access_token = get_access_token()
    if not access_token:
        print("Failed to get token for subscription creation")
        return
    
    # Configure the subscription with shorter expiration (within 1 hour)
    # to avoid needing lifecycleNotificationUrl
    subscription = {
        "changeType": "created",
        "notificationUrl": "https://5d77-2603-3024-1807-6200-b102-a610-1adf-6f38.ngrok-free.app/api/notifications",
        "resource": f"/chats/{chat_id}/messages",
        "expirationDateTime": (datetime.now(timezone.utc) + timedelta(minutes=50)).isoformat(),
        "clientState": request_id  # Use request_id as client state for correlation
    }
    
    try:
        response = requests.post(
            "https://graph.microsoft.com/v1.0/subscriptions",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            },
            json=subscription
        )
        
        print(f"Subscription creation response status: {response.status_code}")
        print(f"Subscription creation response: {response.text}")
        
        if response.status_code in (201, 200):
            subscription_data = response.json()
            active_requests[request_id]['subscription_id'] = subscription_data.get('id')
            print(f"Subscription created: {subscription_data.get('id')}")
        else:
            print(f"Error creating subscription: {response.status_code}")
            print(f"Response: {response.text}")
    except Exception as e:
        print(f"Exception creating subscription: {str(e)}")
        print(f"Response: {response.text if 'response' in locals() else 'No response'}")

@app.route('/api/notifications', methods=['POST'])
def handle_notifications():
    """
    Webhook endpoint for receiving Microsoft Graph notifications
    """
    # Validate the notification
    if request.args.get('validationToken'):
        # Handle subscription validation
        return request.args.get('validationToken'), 200, {'Content-Type': 'text/plain'}
    
    notifications = request.json.get('value', [])
    
    for notification in notifications:
        client_state = notification.get('clientState')
        resource_data = notification.get('resourceData', {})
        
        # Check if this is a message in a tracked chat
        if client_state in active_requests:
            # Get the message details from Microsoft Graph
            fetch_and_process_chat_message(client_state, resource_data.get('id'))
    
    return jsonify({}), 202

def fetch_and_process_chat_message(request_id, message_id):
    """
    Fetch a specific message from a Teams chat and process it
    """
    # Skip already processed messages
    if request_id in active_requests and message_id in active_requests[request_id].get('processed_messages', set()):
        print(f"Skipping already processed message {message_id} for request {request_id}")
        return
    
    access_token = get_access_token()
    if not access_token:
        print("Failed to get token for fetching message")
        return
    
    chat_id = active_requests[request_id]['teams_chat_id']
    
    try:
        response = requests.get(
            f"https://graph.microsoft.com/v1.0/chats/{chat_id}/messages/{message_id}",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        
        if response.status_code == 200:
            message_data = response.json()
            
            # Skip processing if this is the initial message we sent
            if message_id == active_requests[request_id].get('initial_message_id'):
                return
            
            # Extract the message content - strip HTML if present
            content = message_data.get('body', {}).get('content', '')
            # Very basic HTML stripping - in production you'd want a proper HTML parser
            if message_data.get('body', {}).get('contentType') == 'html':
                import re
                # Try to extract just the message text (skip the "From [username]:" part)
                user_message_match = re.search(r'<p><strong>From.*?:</strong>\s*(.*?)</p>', content)
                if user_message_match:
                    # This is a message from the user that we sent to Teams
                    # We should skip it since we already show it in the UI
                    print(f"Skipping user message echo: {user_message_match.group(1)}")
                    
                    # Still mark as processed
                    if 'processed_messages' not in active_requests[request_id]:
                        active_requests[request_id]['processed_messages'] = set()
                    active_requests[request_id]['processed_messages'].add(message_id)
                    return
                
                # For other HTML messages, strip tags
                content = re.sub(r'<[^>]+>', '', content)
            
            from_user = message_data.get('from', {}).get('user', {}).get('displayName', 'Support Agent')
            
            # Update request status
            active_requests[request_id]['status'] = 'responded'
            
            # Prepare response data
            response_data = {
                'requestId': request_id,
                'message': content,
                'responderName': from_user,
                'timestamp': datetime.now().isoformat()
            }
            
            # Send response via WebSocket
            socketio.emit('support_response', response_data, room=request_id)
            
            # Mark this message as processed to avoid duplicates
            if 'processed_messages' not in active_requests[request_id]:
                active_requests[request_id]['processed_messages'] = set()
            active_requests[request_id]['processed_messages'].add(message_id)
            
            print(f"Processed message from {from_user} for request {request_id}")
        else:
            print(f"Error fetching message: {response.status_code}")
            print(f"Response: {response.text}")
    except Exception as e:
        print(f"Exception fetching message: {str(e)}")

@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection"""
    print('Client connected')

@socketio.on('register')
def handle_register(data):
    """Register client to a specific support request room"""
    request_id = data.get('requestId')
    if request_id:
        # Join a room specific to this request ID
        join_room(request_id)
        print(f'Client joined room: {request_id}')
        
        # If there's already an update, send it immediately
        if request_id in active_requests and active_requests[request_id]['status'] == 'responded':
            emit('support_response', {
                'requestId': request_id,
                'message': 'A response has already been provided. Please check your history.',
                'responderName': 'System',
                'timestamp': datetime.now().isoformat()
            })

@socketio.on('user_message_echo')
def handle_user_message(data):
    """Echo the user's message back to confirm receipt"""
    room = data.get('requestId')
    if room:
        emit('user_message_echo', data, room=room)

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection"""
    print('Client disconnected')

# Add this handler to your Flask backend

@socketio.on('unregister')
def handle_unregister(data):
    """Unregister client from a specific support request room when ending a conversation"""
    request_id = data.get('requestId')
    if request_id:
        # Leave the room for this request ID
        leave_room(request_id)
        print(f'Client left room: {request_id}')
        
        # Confirm to the client
        emit('unregister_success', {'requestId': request_id})
        
        # Optionally, you can update any server-side state about active requests
        # For example, you might want to mark this request as "concluded" or "aborted"
        if request_id in active_requests:
            active_requests[request_id]['status'] = 'aborted'
    else:
        emit('error', {'message': 'No request ID provided for unregistration'})

def get_user_id_by_email(email):
    access_token = get_access_token()
    if not access_token:
        print("Failed to get access token")
        return None
    
    response = requests.get(
        f"https://graph.microsoft.com/v1.0/users/{email}",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    
    if response.status_code == 200:
        user_data = response.json()
        return user_data['id']
    else:
        print(f"Error fetching user: {response.status_code}")
        print(f"Response: {response.text}")
        return None

# Example usage:
# Get support team members by email
support_email_1 = "david@canopywave.com"
support_email_2 = "yachal@canopywave.com"

user_id_1 = get_user_id_by_email(support_email_1)
user_id_2 = get_user_id_by_email(support_email_2)

SUPPORT_TEAM_MEMBERS = [
    {"@odata.type": "microsoft.graph.aadUserConversationMember", "userId": user_id_1},
    {"@odata.type": "microsoft.graph.aadUserConversationMember", "userId": user_id_2}
]

print(f"Configured support team members: {SUPPORT_TEAM_MEMBERS}")

if __name__ == '__main__':
    # Run the Flask app with SocketIO
    port = int(os.environ.get('PORT', 5001))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)



















