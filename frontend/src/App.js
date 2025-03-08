// src/App.js
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

// Backend API URL - change to your Flask server address
const API_URL = 'http://localhost:5001';
// WebSocket URL - should match your Flask SocketIO server
const SOCKET_URL = 'http://localhost:5001';

function App() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [requestId, setRequestId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Add these state variables
  const [chatbotActive, setChatbotActive] = useState(true);
  const [chatHistory, setChatHistory] = useState([]);
  const [suggestedOptions, setSuggestedOptions] = useState([]);
  const [userInfo, setUserInfo] = useState(null);
  const [endChat, setEndChat] = useState(false);

  // Add initial effect to start chatbot
  useEffect(() => {
    if (chatbotActive && chatHistory.length === 0) {
      // Initial chatbot message
      const initialMessage = {
        sender: 'Chatbot',
        text: "Hello! I'm your support assistant. What can I help you with today?",
        timestamp: new Date().toISOString(),
        isUser: false,
        isChatbot: true
      };
      
      setChatHistory([initialMessage]);
      
      // Set initial options
      setSuggestedOptions([
        'Issues with my VM',
        'Account access problems',
        'Billing questions',
        'Service outage',
        'Talk to a support agent'
      ]);
      
      // Simulate fetching user info
      setUserInfo({
        name: 'Customer A',
        email: 'abc@123.com',
        company: 'Acme Corp',
        plan: 'Enterprise',
        activeServices: ['VM Hosting', 'Storage', 'CDN']
      });
    }
  }, [chatbotActive, chatHistory]);

  // Handle chatbot option selection
  const handleOptionSelect = (option) => {
    // Add user's selection to chat
    const userMessage = {
      sender: userName || userInfo?.name || 'You',
      text: option,
      timestamp: new Date().toISOString(),
      isUser: true
    };
    
    setChatHistory(prev => [...prev, userMessage]);
    
    // Process the selected option
    setTimeout(() => {
      let botResponse = {};
      let newOptions = [];
      
      // Special case handling for agent connection
      if (option === 'Yes, connect me to an agent' || option === 'Talk to a support agent') {
        botResponse = {
          sender: 'Chatbot',
          text: "I'll connect you with a support agent. Please provide a brief description of your issue.",
          timestamp: new Date().toISOString(),
          isUser: false,
          isChatbot: true
        };
        
        setChatHistory(prev => [...prev, botResponse]);
        setChatbotActive(false);
        return;
      }
      
      // Special case handling for ending chat
      if (option === 'No, I\'ll try something else') {
        botResponse = {
          sender: 'Chatbot',
          text: "Thank you for using our support chat. If you need assistance in the future, feel free to start a new conversation.",
          timestamp: new Date().toISOString(),
          isUser: false,
          isChatbot: true
        };
        
        setChatHistory(prev => [...prev, botResponse]);
        setSuggestedOptions([]);
        setEndChat(true);
        return;
      }
      
      switch(option) {
        // case 'Talk to a support agent':
        //   botResponse = {
        //     sender: 'Chatbot',
        //     text: "I'll connect you with a support agent. Please provide a brief description of your issue.",
        //     timestamp: new Date().toISOString(),
        //     isUser: false,
        //     isChatbot: true
        //   };
        //   setChatbotActive(false);
        //   break;
          
        case 'Issues with my VM':
          botResponse = {
            sender: 'Chatbot',
            text: 'What specific issue are you experiencing with your VM?',
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          newOptions = [
            'VM won\'t start',
            'VM is running slow',
            'Cannot connect to VM',
            'Disk space issues',
            'Talk to a support agent'
          ];
          break;
          
        case 'Talk to a support agent':
          botResponse = {
            sender: 'Chatbot',
            text: "I'll connect you with a support agent. Please provide a brief description of your issue.",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          setChatbotActive(false);
          break;
          
        case 'VM won\'t start':
        case 'VM is running slow':
        case 'Cannot connect to VM':
        case 'Disk space issues':
          botResponse = {
            sender: 'Chatbot',
            text: "I understand you're having an issue with your VM. Let me try to help you with that. Would you like some troubleshooting steps or would you prefer to speak with a support agent?",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          newOptions = ['Show troubleshooting steps', 'Connect me to an agent'];
          break;
          
        case 'Show troubleshooting steps':
          botResponse = {
            sender: 'Chatbot',
            text: "Here are some basic troubleshooting steps:\n\n1. Check your VM's status in the dashboard\n2. Try restarting the VM from the control panel\n3. Verify your network settings\n4. Check resource allocation (CPU, memory)\n\nDid any of these help resolve your issue?",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          newOptions = ['Issue resolved', 'Still having problems'];
          break;
        
        case 'Issue resolved':
          botResponse = {
            sender: 'Chatbot',
            text: "Great! I'm glad we were able to resolve your issue. Is there anything else you'd like help with today?",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          newOptions = ['Yes, I have another question', 'No, that\'s all for now'];
          break;
          
        case 'Still having problems':
        case 'Connect me to an agent':
          botResponse = {
            sender: 'Chatbot',
            text: "I'm sorry you're still experiencing issues. Let me connect you with a support agent who can help you further.",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          setChatbotActive(false);
          break;
          
        case 'Yes, I have another question':
          botResponse = {
            sender: 'Chatbot',
            text: "What else can I help you with today?",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          setSuggestedOptions([
            'Issues with my VM',
            'Account access problems',
            'Billing questions',
            'Service outage',
            'Other issues'
          ]);
          break;
          
        case 'No, that\'s all for now':
          botResponse = {
            sender: 'Chatbot',
            text: "Thank you for using our support chat. If you need any further assistance, feel free to start a new conversation.",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          setSuggestedOptions([]);
          setEndChat(true);
          break;

        // Add more cases for other common options
        case 'Account access problems':
          botResponse = {
            sender: 'Chatbot',
            text: "I'm sorry to hear you're having account access issues. Could you specify the problem you're experiencing?",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          newOptions = [
            'Forgot password',
            'Account locked',
            'Two-factor authentication issues',
            'Can\'t login',
            'Talk to a support agent'
          ];
          break;
          
        case 'Billing questions':
          botResponse = {
            sender: 'Chatbot',
            text: "I can help with billing questions. What specific information are you looking for?",
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          newOptions = [
            'Current invoice',
            'Payment methods',
            'Billing cycle',
            'Pricing questions',
            'Talk to a support agent'
          ];
          break;
          
        // Default case for any other options
        default:
          botResponse = {
            sender: 'Chatbot',
            text: 'I don\'t have specific information about that. Would you like to speak with a support agent?',
            timestamp: new Date().toISOString(),
            isUser: false,
            isChatbot: true
          };
          newOptions = ['Yes, connect me to an agent', 'No, I\'ll try something else'];
      }
      
      setChatHistory(prev => [...prev, botResponse]);
      setSuggestedOptions(newOptions);
    }, 500);
  };

  // Combined handleSubmit function that handles both chatbot and direct support flows
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!newMessage.trim()) return;
    
    console.log("Submitting message:", newMessage);
    
    if (chatbotActive) {
      // Add user message to chat history
      const userMessage = {
        sender: userName || userInfo?.name || 'You',
        text: newMessage,
        timestamp: new Date().toISOString(),
        isUser: true
      };
      
      setChatHistory(prev => [...prev, userMessage]);
      
      // Chatbot is active, handle message here
      setTimeout(() => {
        const botResponse = {
          sender: 'Chatbot',
          text: 'I think I need more information to help with that. Would you like to speak with a support agent?',
          timestamp: new Date().toISOString(),
          isUser: false,
          isChatbot: true
        };
        
        setChatHistory(prev => [...prev, botResponse]);
        setSuggestedOptions(['Yes, connect me to an agent', 'No, I\'ll try something else']);
      }, 500);
    } else {
      // Add user message to messages (for regular support chat)
      const userMessage = {
        sender: userName || userInfo?.name || 'You',
        text: newMessage,
        timestamp: new Date().toISOString(),
        isUser: true
      };
      
      setMessages(prevMessages => [...prevMessages, userMessage]);
      setIsLoading(true);
      
      try {
        // If we already have a requestId, this is a follow-up message
        if (requestId) {
          console.log("Sending follow-up message for request:", requestId);
          
          // Send follow-up message to backend
          const response = await fetch(`${API_URL}/api/message`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              requestId,
              message: newMessage
            })
          });
          
          console.log("Follow-up response status:", response.status);
          const data = await response.json();
          console.log("Follow-up response data:", data);
          
          if (!data.success) {
            // Handle error for follow-up message
            setMessages(prevMessages => [
              ...prevMessages,
              {
                sender: 'System',
                text: `Error: ${data.message || 'Failed to send follow-up message'}`,
                timestamp: new Date().toISOString(),
                isUser: false,
                isSystem: true,
                isError: true
              }
            ]);
            setIsLoading(false);
          }
        } else {
          // This is a new support request
          console.log("Sending new support request");
          
          // Store user info for later use
          if (userName) {
            sessionStorage.setItem('userName', userName);
          } else if (userInfo?.name) {
            sessionStorage.setItem('userName', userInfo.name);
            setUserName(userInfo.name);
          }
          
          if (userEmail) {
            sessionStorage.setItem('userEmail', userEmail);
          } else if (userInfo?.email) {
            sessionStorage.setItem('userEmail', userInfo.email);
            setUserEmail(userInfo.email);
          }
          
          // Include the chat history with the support request if coming from chatbot
          const chatSummary = chatHistory.length > 0 
            ? chatHistory.map(msg => `${msg.sender}: ${msg.text}`).join('\n')
            : '';
          
          // Send support request to backend
          const response = await fetch(`${API_URL}/api/support`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: newMessage,
              userName: userName || userInfo?.name || 'Anonymous User',
              userEmail: userEmail || userInfo?.email || 'anonymous@example.com',
              chatHistory: chatSummary
            })
          });
          
          console.log("New request response status:", response.status);
          const data = await response.json();
          console.log("New request response data:", data);
          
          if (data.success) {
            // Store request ID
            setRequestId(data.requestId);
            sessionStorage.setItem('currentRequestId', data.requestId);
            
            // Register for WebSocket updates with this request ID
            if (socketRef.current && socketRef.current.connected) {
              socketRef.current.emit('register', { requestId: data.requestId });
            }
            
            // Add system message
            setMessages(prevMessages => [
              ...prevMessages,
              {
                sender: 'System',
                text: 'Your support request has been submitted. Please wait for a response.',
                timestamp: new Date().toISOString(),
                isUser: false,
                isSystem: true
              }
            ]);
          } else {
            // Handle error
            setMessages(prevMessages => [
              ...prevMessages,
              {
                sender: 'System',
                text: `Error: ${data.message || 'Failed to submit support request'}`,
                timestamp: new Date().toISOString(),
                isUser: false,
                isSystem: true,
                isError: true
              }
            ]);
            setIsLoading(false);
          }
        }
      } catch (error) {
        console.error('Error with support request:', error);
        
        // Add error message
        setMessages(prevMessages => [
          ...prevMessages,
          {
            sender: 'System',
            text: `Error: ${error.message || 'Failed to connect to support server'}`,
            timestamp: new Date().toISOString(),
            isUser: false,
            isSystem: true,
            isError: true
          }
        ]);
        
        setIsLoading(false);
      }
    }
    
    // Clear input field
    setNewMessage('');
  };

  // Try to load existing requestId from sessionStorage on initial load
  useEffect(() => {
    const savedRequestId = sessionStorage.getItem('currentRequestId');
    const savedUserName = sessionStorage.getItem('userName');
    const savedUserEmail = sessionStorage.getItem('userEmail');
    
    if (savedRequestId) {
      setRequestId(savedRequestId);
    }
    
    if (savedUserName) {
      setUserName(savedUserName);
    }
    
    if (savedUserEmail) {
      setUserEmail(savedUserEmail);
    }
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    // Create socket connection
    socketRef.current = io(SOCKET_URL);
    
    // Set up event listeners
    socketRef.current.on('connect', () => {
      console.log('Connected to WebSocket server');
      setIsConnected(true);
      
      // Register for existing request if available
      if (requestId) {
        socketRef.current.emit('register', { requestId });
      }
    });
    
    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      setIsConnected(false);
    });
    
    socketRef.current.on('support_response', (data) => {
      console.log('Received support response:', data);
      
      // Only process the message if it matches our current requestId
      // This prevents responses from previous conversations appearing in a new one
      if (data.requestId === requestId) {
        // Add response to messages
        setMessages(prevMessages => [
          ...prevMessages,
          {
            sender: data.responderName || 'Support Team',
            text: data.message,
            timestamp: new Date().toISOString(),
            isUser: false
          }
        ]);
        
        // Clear loading state if present
        setIsLoading(false);
      } else {
        console.log('Ignoring message from different request ID:', data.requestId);
      }
    });
    
    // Add event listener for user_message_echo
    socketRef.current.on('user_message_echo', (data) => {
      console.log('Received user message echo:', data);
      // We don't need to add this to messages as we already show the user's message
    });

    // Add handler for unregister confirmation (if backend implements it)
    socketRef.current.on('unregister_success', () => {
      console.log('Successfully unregistered from previous conversation');
    });
    
    // Add handler for errors
    socketRef.current.on('error', (error) => {
      console.error('Socket error:', error);
      // Ensure loading state is cleared even if an error occurs
      setIsLoading(false);
    });
    
    // Clean up on unmount
    return () => {
      if (socketRef.current) {
        // Attempt to clean up any active request
        const currentRequestId = sessionStorage.getItem('currentRequestId');
        if (currentRequestId) {
          socketRef.current.emit('unregister', { requestId: currentRequestId });
        }
        socketRef.current.disconnect();
      }
    };
  }, [requestId]);
  
  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatHistory]);
  
  // Cleanup function to run when a conversation is aborted or reset
  const cleanupConversation = () => {
    setIsLoading(false);
    
    // If there's an active socket connection, attempt to unregister
    if (socketRef.current && socketRef.current.connected) {
      const currentRequestId = sessionStorage.getItem('currentRequestId');
      if (currentRequestId) {
        socketRef.current.emit('unregister', { requestId: currentRequestId });
        console.log('Unregistered from room:', currentRequestId);
      }
    }
  };
  
  // Function to start a new conversation
  const startNewConversation = () => {
    // Clean up the existing conversation first
    cleanupConversation();
    
    // Clear current state
    setRequestId(null);
    setMessages([]);
    setChatHistory([]);
    setChatbotActive(true);
    setEndChat(false);
    sessionStorage.removeItem('currentRequestId');
  };
  
  return (
    <div className="app-container">
      <div className="chat-container">
        <div className="chat-header">
          <h2>Support Chat</h2>
          <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        
        {!requestId && chatbotActive && !endChat && (
          <div className="user-info">
            <input
              type="text"
              placeholder="Your Name"
              value={userName || userInfo?.name || ''}
              onChange={(e) => setUserName(e.target.value)}
              className="user-info-input"
            />
            <input
              type="email"
              placeholder="Your Email"
              value={userEmail || userInfo?.email || ''}
              onChange={(e) => setUserEmail(e.target.value)}
              className="user-info-input"
            />
          </div>
        )}
        
        <div className="messages-container">
          {chatbotActive ? (
            // Chatbot UI
            <>
              {chatHistory.length === 0 ? (
                <div className="empty-state">
                  <p>No messages yet. Start your support conversation!</p>
                </div>
              ) : (
                chatHistory.map((message, index) => (
                  <div
                    key={index}
                    className={`message ${message.isUser ? 'user-message' : 'support-message'} ${
                      message.isChatbot ? 'chatbot-message' : ''
                    }`}
                  >
                    <div className="message-header">
                      <span className="sender">{message.sender}</span>
                      <span className="timestamp">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="message-text">{message.text}</div>
                    
                    {/* Show user info if this is the first chatbot message */}
                    {index === 0 && message.isChatbot && userInfo && (
                      <div className="user-info-display">
                        <h4>User Information</h4>
                        <p><strong>Name:</strong> {userInfo.name}</p>
                        <p><strong>Email:</strong> {userInfo.email}</p>
                        <p><strong>Company:</strong> {userInfo.company}</p>
                        <p><strong>Plan:</strong> {userInfo.plan}</p>
                        <p><strong>Active Services:</strong> {userInfo.activeServices.join(', ')}</p>
                      </div>
                    )}
                  </div>
                ))
              )}
              
              {/* Option buttons for chatbot */}
              {!endChat && suggestedOptions.length > 0 && (
                <div className="chatbot-options">
                  {suggestedOptions.map((option, index) => (
                    <button 
                      key={index} 
                      className="chatbot-option-button"
                      data-agent-connect={option === 'Talk to a support agent' ? 'true' : 'false'}
                      onClick={() => handleOptionSelect(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            // Regular support chat UI
            <>
              {messages.length === 0 ? (
                <div className="empty-state">
                  <p>No messages yet. Start your support conversation!</p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={index}
                    className={`message ${message.isUser ? 'user-message' : 'support-message'} ${
                      message.isSystem ? 'system-message' : ''
                    } ${message.isError ? 'error-message' : ''}`}
                  >
                    <div className="message-header">
                      <span className="sender">{message.sender}</span>
                      <span className="timestamp">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="message-text">{message.text}</div>
                  </div>
                ))
              )}
            </>
          )}
          
          {isLoading && (
            <div className="loading-indicator">
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
              <div className="loading-dot"></div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
        
        {/* Hide form when chat is ended */}
        {!endChat && (
          <form className="message-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type your message..."
              disabled={isLoading}
              className="message-input"
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || isLoading}
              className="send-button"
            >
              Send
            </button>
          </form>
        )}
        
        {(requestId || endChat) && (
          <div className="new-conversation">
            <button 
              onClick={startNewConversation}
              className="new-conversation-button"
            >
              Start New Conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;