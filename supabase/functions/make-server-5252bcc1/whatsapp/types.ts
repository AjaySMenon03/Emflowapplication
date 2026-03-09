/**
 * EM Flow — WhatsApp Types
 */

export type MessageType = "confirmation" | "your_turn" | "no_show" | "cancelled" | "welcome" | "waitlist_welcome" | "waitlist_confirmed";
export type SupportedLocale = "en" | "hi" | "ta" | "ml";

export interface WhatsAppPayload {
    to: string;               // E.164 phone number
    businessId: string;
    entryId: string;
    customerId: string | null;
    messageType: MessageType;
    locale: SupportedLocale;
    templateVars: {
        customerName: string;
        ticketNumber: string;
        queueName: string;
        position?: number;
        estimatedMinutes?: number;
        businessName?: string;
        locationName?: string;
    };
}

export interface SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}
