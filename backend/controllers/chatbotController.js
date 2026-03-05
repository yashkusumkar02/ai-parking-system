const db = require('../config/database');
const Joi = require('joi');

// Validation schema
const sendMessageSchema = Joi.object({
  message: Joi.string().required(),
  context: Joi.object().optional(),
  timestamp: Joi.string().isoDate().optional()
});

class ChatbotController {
  // Send message to chatbot
  static async sendMessage(req, res) {
    try {
      const { error, value } = sendMessageSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      const { message, context } = value;

      // Get previous intent from context for conversation flow
      const previousIntent = context?.previousIntent || null;
      
      // Analyze user intent
      const intent = ChatbotController.analyzeIntent(message, previousIntent);
      
      // Generate response based on intent
      const response = await ChatbotController.generateResponse(intent, message, context);

      // Save conversation to database (optional)
      try {
        await ChatbotController.saveConversation(req, message, response, intent);
      } catch (saveError) {
        console.error('Error saving conversation:', saveError.message);
        // Don't fail the request if save fails
      }

      res.json({
        success: true,
        response: response.text,
        intent: intent.name,
        confidence: intent.confidence,
        entities: intent.entities
      });
    } catch (error) {
      console.error('Error in chatbot:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process message',
        message: error.message
      });
    }
  }

  // Get suggestions based on intent
  static async getSuggestions(req, res) {
    try {
      const { intent } = req.params;

      const suggestions = ChatbotController.getIntentSuggestions(intent);

      res.json({
        success: true,
        suggestions
      });
    } catch (error) {
      console.error('Error getting suggestions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get suggestions',
        message: error.message
      });
    }
  }

  // Get conversation history
  static async getConversationHistory(req, res) {
    try {
      const { sessionId } = req.params;
      const limit = parseInt(req.query.limit) || 20;

      const query = `
        SELECT 
          id,
          user_message,
          bot_response,
          intent,
          confidence,
          created_at
        FROM chatbot_conversations
        WHERE session_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await db.query(query, [sessionId, limit]);
      const conversations = result.rows.reverse();

      res.json({
        success: true,
        conversations,
        count: conversations.length
      });
    } catch (error) {
      console.error('Error getting conversation history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get conversation history',
        message: error.message
      });
    }
  }

  // Analyze user intent from message
  static analyzeIntent(message, previousIntent = null) {
    const lowerMessage = message.toLowerCase();
    
    // Check for conversational responses first
    const conversationalResponses = this.detectConversationalResponse(lowerMessage, previousIntent);
    if (conversationalResponses) {
      return conversationalResponses;
    }
    
    const intents = [
      {
        name: 'find_parking',
        keywords: ['find', 'available', 'vacant', 'empty', 'search', 'look for', 'where', 'yes', 'sure', 'ok', 'okay'],
        patterns: [/find.*parking/, /available.*slot/, /where.*park/, /^(yes|yeah|sure|ok|okay)$/],
        entities: ['location', 'time']
      },
      {
        name: 'check_pricing',
        keywords: ['cost', 'price', 'rate', 'fee', 'charge', 'how much', 'pricing'],
        patterns: [/how much.*cost/, /what.*price/, /rate.*hour/],
        entities: ['duration', 'vehicle_type']
      },
      {
        name: 'check_occupancy',
        keywords: ['occupancy', 'busy', 'crowded', 'full', 'capacity', 'availability'],
        patterns: [/how.*busy/, /occupancy.*rate/, /many.*spots/],
        entities: ['time_range', 'lot_name']
      },
      {
        name: 'get_directions',
        keywords: ['direction', 'location', 'address', 'where', 'get to', 'navigate'],
        patterns: [/how.*get.*to/, /where.*located/, /direction.*to/],
        entities: ['destination']
      },
      {
        name: 'booking_help',
        keywords: ['book', 'reserve', 'reservation', 'hold', 'save'],
        patterns: [/how.*book/, /can.*reserve/, /want.*to book/],
        entities: ['time', 'duration']
      },
      {
        name: 'release_slot',
        keywords: ['release', 'leave', 'exit', 'check out', 'finish'],
        patterns: [/how.*release/, /need.*to leave/, /done.*parking/],
        entities: ['slot_number']
      },
      {
        name: 'hours_of_operation',
        keywords: ['open', 'close', 'hours', 'time', 'schedule', 'when'],
        patterns: [/what.*hours/, /when.*open/, /closing.*time/],
        entities: ['day']
      },
      {
        name: 'payment_methods',
        keywords: ['pay', 'payment', 'card', 'cash', 'method', 'accept'],
        patterns: [/what.*payment/, /can.*pay.*with/, /do.*accept/],
        entities: []
      },
      {
        name: 'support',
        keywords: ['help', 'support', 'contact', 'problem', 'issue', 'wrong'],
        patterns: [/i need.*help/, /have.*problem/, /contact.*support/],
        entities: ['issue_type']
      },
      {
        name: 'general',
        keywords: [],
        patterns: [],
        entities: []
      }
    ];

    // Calculate scores for each intent
    const scoredIntents = intents.map(intent => {
      let score = 0;

      // Check keyword matches
      intent.keywords.forEach(keyword => {
        if (lowerMessage.includes(keyword)) {
          score += 2;
        }
      });

      // Check pattern matches
      intent.patterns.forEach(pattern => {
        if (pattern.test(lowerMessage)) {
          score += 5;
        }
      });

      return {
        name: intent.name,
        score,
        confidence: Math.min(score / 10, 1),
        entities: intent.entities
      };
    });

    // Sort by score and get best match
    scoredIntents.sort((a, b) => b.score - a.score);
    const bestMatch = scoredIntents[0];

    // Extract entities (simple implementation)
    const entities = ChatbotController.extractEntities(message, bestMatch.name);

    return {
      ...bestMatch,
      entities
    };
  }

  // Detect conversational responses (yes, no, thanks, etc.)
  static detectConversationalResponse(message, previousIntent) {
    const positiveResponses = ['yes', 'yeah', 'sure', 'ok', 'okay', 'yep', 'absolutely', 'definitely', 'please', 'pls'];
    const negativeResponses = ['no', 'nope', 'nah', 'not really', 'never mind'];
    const thanksResponses = ['thanks', 'thank you', 'thx', 'appreciate it'];
    
    if (positiveResponses.includes(message)) {
      // If user says yes to a follow-up question, continue the previous intent
      if (previousIntent === 'find_parking') {
        return {
          name: 'show_availability',
          keywords: [],
          score: 10,
          confidence: 0.95,
          entities: {}
        };
      }
      if (previousIntent === 'check_pricing') {
        return {
          name: 'pricing_details',
          keywords: [],
          score: 10,
          confidence: 0.95,
          entities: {}
        };
      }
      // Default to continuing previous intent
      return {
        name: previousIntent || 'general',
        keywords: [],
        score: 10,
        confidence: 0.9,
        entities: {}
      };
    }
    
    if (negativeResponses.includes(message)) {
      return {
        name: 'decline_offer',
        keywords: [],
        score: 10,
        confidence: 0.9,
        entities: {}
      };
    }
    
    if (thanksResponses.includes(message)) {
      return {
        name: 'gratitude',
        keywords: [],
        score: 10,
        confidence: 0.95,
        entities: {}
      };
    }
    
    return null;
  }

  // Extract entities from message
  static extractEntities(message, intent) {
    const entities = {};
    const lowerMessage = message.toLowerCase();

    // Extract time-related entities
    const timePatterns = [
      /\b(\d+)\s*(am|pm)\b/g,
      /\b(morning|afternoon|evening|night)\b/g,
      /\b(today|tomorrow|now)\b/g,
      /\b(\d+)\s*(hour|minute)s?\b/g
    ];

    timePatterns.forEach(pattern => {
      const matches = lowerMessage.match(pattern);
      if (matches) {
        entities.time = matches;
      }
    });

    // Extract location entities
    const locationPatterns = [
      /\b(lot\s*\w+|parking\s*\w+)\b/gi
    ];

    locationPatterns.forEach(pattern => {
      const matches = lowerMessage.match(pattern);
      if (matches) {
        entities.location = matches;
      }
    });

    return entities;
  }

  // Generate response based on intent
  static async generateResponse(intent, message, context) {
    const responses = {
      find_parking: {
        text: "I can help you find available parking! Based on current data, there are several available spots in our parking lots. Would you like me to show you the real-time availability for a specific lot?",
        actions: ['show_availability', 'view_map']
      },
      show_availability: {
        text: "Great! Currently we have:\n\n🅿️ **Main Parking Lot**:\n• 18 out of 50 spots available\n• Occupancy: 64%\n• Most available spots are on Level 2\n\nWould you like to:\n1. See a detailed breakdown by floor?\n2. Book a spot now?\n3. View the parking map?",
        actions: ['view_detailed_availability', 'book_now', 'view_map']
      },
      check_pricing: {
        text: "Our parking rates are:\n• $2 per hour for the first 3 hours\n• $5 per hour after 3 hours\n• Daily maximum: $25\n• Monthly passes available for $200\n\nWould you like to know about any special discounts or promotions?",
        actions: ['view_pricing_details', 'calculate_cost']
      },
      pricing_details: {
        text: "Here are our complete pricing details:\n\n💰 **Hourly Rates**:\n• First hour: $2\n• 1-3 hours: $2/hour\n• 3+ hours: $5/hour\n\n🎫 **Daily & Monthly**:\n• Daily max: $25\n• Monthly pass: $200 (save ~15%)\n\n🎁 **Discounts**:\n• Early bird (before 7 AM): 10% off\n• Evening (after 6 PM): Flat $10\n• Weekend special: $15/day\n\nWould you like to calculate your estimated cost?",
        actions: ['calculate_cost', 'view_discounts']
      },
      check_occupancy: {
        text: "Let me check the current occupancy rates for you. Our main parking lot is currently at about 65% capacity. Peak hours are typically between 9 AM - 11 AM and 2 PM - 4 PM. Would you like to see real-time occupancy data?",
        actions: ['view_occupancy_chart', 'set_availability_alert']
      },
      get_directions: {
        text: "Our parking facility is located at 123 Main Street. From the highway:\n1. Take Exit 42B\n2. Turn right at the traffic light\n3. Continue for 0.3 miles\n4. Look for the blue parking signs on your right\n\nGPS coordinates: 40.7128° N, 74.0060° W",
        actions: ['open_maps', 'show_directions']
      },
      booking_help: {
        text: "I'd be happy to help you book a parking spot! You can:\n1. Select an available slot from the interactive map\n2. Choose your estimated duration\n3. Confirm your booking\n\nYour booking will be valid for the selected time period. Would you like me to guide you through the booking process?",
        actions: ['start_booking', 'view_booked_slots']
      },
      release_slot: {
        text: "To release your parking slot:\n1. Go to 'My Bookings' in your dashboard\n2. Find your active booking\n3. Click 'Release Slot'\n\nThis will free up the space for other users. Is there anything else you need help with?",
        actions: ['go_to_bookings', 'confirm_release']
      },
      hours_of_operation: {
        text: "Our parking facility operates 24/7, every day of the week!\n• Monday - Sunday: Open 24 hours\n• Holidays: Open 24 hours\n\nHowever, staff assistance is available from 6 AM to 10 PM daily.",
        actions: []
      },
      payment_methods: {
        text: "We accept multiple payment methods:\n• Credit/Debit Cards (Visa, MasterCard, Amex)\n• Digital Wallets (Apple Pay, Google Pay)\n• Cash (at pay stations)\n• Monthly subscription\n\nAll transactions are secure and encrypted.",
        actions: ['update_payment_method']
      },
      support: {
        text: "I'm here to help! If you're experiencing issues, you can:\n• Describe your problem in detail\n• Contact our support team at support@parking.com\n• Call us at (555) 123-4567\n• Visit our help center\n\nWhat specific issue are you facing?",
        actions: ['contact_support', 'view_faq']
      },
      general: {
        text: "Thank you for your message! I'm your AI parking assistant. I can help you with:\n• Finding available parking spots\n• Checking rates and pricing\n• Booking parking slots\n• Getting directions\n• Answering questions about our facilities\n\nHow can I assist you today?",
        actions: ['view_services', 'faq']
      },
      decline_offer: {
        text: "No problem! Is there anything else I can help you with? Feel free to ask me about parking availability, rates, booking, or any other questions you might have.",
        actions: ['ask_different_question', 'view_services']
      },
      gratitude: {
        text: "You're welcome! I'm here to help anytime. Have a great day! 😊",
        actions: []
      }
    };

    return responses[intent.name] || responses.general;
  }

  // Get suggestions for specific intent
  static getIntentSuggestions(intent) {
    const suggestionMap = {
      find_parking: [
        'Show me available spots',
        'Where is the nearest parking?',
        'Check real-time availability'
      ],
      check_pricing: [
        'Calculate my parking cost',
        'Are there any discounts?',
        'Monthly pass information'
      ],
      check_occupancy: [
        'When is it least busy?',
        'Show occupancy trends',
        'Set availability alert'
      ],
      get_directions: [
        'Open in Google Maps',
        'Show on map',
        'Public transport options'
      ],
      booking_help: [
        'Book a spot now',
        'How to book?',
        'View my bookings'
      ],
      release_slot: [
        'Release my slot',
        'Cancel booking',
        'Extend parking time'
      ],
      hours_of_operation: [
        'Holiday hours',
        'Peak hours',
        'Staff availability'
      ],
      payment_methods: [
        'Add payment method',
        'Payment failed help',
        'Refund policy'
      ],
      support: [
        'Report a problem',
        'Lost and found',
        'Feedback'
      ],
      general: [
        'View all services',
        'FAQ',
        'Contact support'
      ],
      show_availability: [
        'Show detailed breakdown',
        'Book a spot now',
        'View parking map'
      ],
      pricing_details: [
        'Calculate my cost',
        'Show discounts',
        'Get monthly pass'
      ],
      decline_offer: [
        'Tell me about something else',
        'What services do you offer?',
        'Main menu'
      ]
    };

    return suggestionMap[intent] || suggestionMap.general;
  }

  // Save conversation to database
  static async saveConversation(req, userMessage, botResponse, intent) {
    const sessionId = req.headers['x-session-id'] || 'default-session';
    const userId = req.user?.userId || null;

    const query = `
      INSERT INTO chatbot_conversations (
        session_id,
        user_id,
        user_message,
        bot_response,
        intent,
        confidence,
        entities,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    `;

    const values = [
      sessionId,
      userId,
      userMessage,
      botResponse.text,
      intent.name,
      intent.confidence,
      JSON.stringify(intent.entities)
    ];

    await db.query(query, values);
  }
}

module.exports = ChatbotController;
