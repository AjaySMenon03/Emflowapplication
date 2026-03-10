/**
 * Quecumber — WhatsApp Message Templates
 *
 * Language-aware templates for: en, hi, ta, ml
 */

import type { SupportedLocale, MessageType, WhatsAppPayload } from "./types.ts";

export const templates: Record<
  SupportedLocale,
  Record<MessageType, (v: WhatsAppPayload["templateVars"]) => string>
> = {
  en: {
    confirmation: (v) =>
      `Hello ${v.customerName}! Your ticket *${v.ticketNumber}* for ${v.queueName} has been confirmed.\n\nPosition: #${v.position ?? "..."}\nEst. wait: ~${v.estimatedMinutes ?? "..."} min\n${v.locationName ? `Location: ${v.locationName}` : ""}\n\nPlease stay nearby. We'll notify you when it's your turn.\n\n— ${v.businessName || "Quecumber"}`,

    your_turn: (v) =>
      `${v.customerName}, it's your turn! Please proceed to the counter now.\n\nTicket: *${v.ticketNumber}*\nService: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    no_show: (v) =>
      `${v.customerName}, you were called for ticket *${v.ticketNumber}* but didn't arrive.\n\nYour entry has been marked as missed. Please rejoin the queue if you still need service.\n\n— ${v.businessName || "Quecumber"}`,

    cancelled: (v) =>
      `${v.customerName}, your ticket *${v.ticketNumber}* for ${v.queueName} has been cancelled.\n\nIf this was a mistake, you can rejoin the queue at any time.\n\n— ${v.businessName || "Quecumber"}`,

    welcome: (v) =>
      `Hello ${v.customerName}, welcome to EMFlow! We are excited to serve you at ${v.businessName || "our business"}.`,

    waitlist_welcome: (v) =>
      `Hello ${v.customerName}! The maximum customer count is reached. You are in the waiting list. If any of the confirmed customers is a no-show or canceled, you will be considered as next.\n\nWaitlist Number: *${v.ticketNumber}*\nService: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    waitlist_confirmed: (v) =>
      `Hurray ${v.customerName}! Your slot is confirmed. Your current position is #${v.position ?? "..."} and your estimated wait time is ~${v.estimatedMinutes ?? "..."} minutes.\n\nTicket: *${v.ticketNumber}*\nService: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,
  },

  hi: {
    confirmation: (v) =>
      `नमस्ते ${v.customerName}! ${v.queueName} के लिए आपका टिकट *${v.ticketNumber}* पुष्टि हो गया है।\n\nस्थिति: #${v.position ?? "..."}\nअनुमानित प्रतीक्षा: ~${v.estimatedMinutes ?? "..."} मिनट\n${v.locationName ? `स्थान: ${v.locationName}` : ""}\n\nकृपया पास में रहें। आपकी बारी आने पर हम आपको सूचित करेंगे।\n\n— ${v.businessName || "Quecumber"}`,

    your_turn: (v) =>
      `${v.customerName}, आपकी बारी आ गई है! कृपया अभी काउंटर पर आएं।\n\nटिकट: *${v.ticketNumber}*\nसेवा: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    no_show: (v) =>
      `${v.customerName}, टिकट *${v.ticketNumber}* के लिए आपको बुलाया गया लेकिन आप नहीं आए।\n\nआपकी प्रविष्टि अनुपस्थित के रूप में चिह्नित की गई है। यदि आपको अभी भी सेवा की आवश्यकता है तो कृपया फिर से कतार में शामिल हों।\n\n— ${v.businessName || "Quecumber"}`,

    cancelled: (v) =>
      `${v.customerName}, ${v.queueName} के लिए आपका टिकट *${v.ticketNumber}* रद्द कर दिया गया है।\n\nयदि यह गलती से हुआ है, तो आप किसी भी समय फिर से कतार में शामिल हो सकते हैं।\n\n— ${v.businessName || "Quecumber"}`,

    welcome: (v) =>
      `नमस्ते ${v.customerName}, EMFlow में आपका स्वागत है! ${v.businessName || "हम"} आपकी सेवा करने के लिए उत्साहित हैं।`,

    waitlist_welcome: (v) =>
      `नमस्ते ${v.customerName}! ग्राहकों की अधिकतम संख्या पूरी हो गई है। आप प्रतीक्षा सूची में हैं। यदि कोई पुष्ट ग्राहक नहीं आता है या रद्द कर देता है, तो आपको अगला माना जाएगा।\n\nप्रतीक्षा संख्या: *${v.ticketNumber}*\nसेवा: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    waitlist_confirmed: (v) =>
      `खुशखबरी ${v.customerName}! आपका स्लॉट पुष्ट हो गया है। आपकी वर्तमान स्थिति #${v.position ?? "..."} है और आपका अनुमानित प्रतीक्षा समय ~${v.estimatedMinutes ?? "..."} मिनट है।\n\nटिकट: *${v.ticketNumber}*\nसेवा: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,
  },

  ta: {
    confirmation: (v) =>
      `வணக்கம் ${v.customerName}! ${v.queueName} க்கான உங்கள் டிக்கெட் *${v.ticketNumber}* உறுதிப்படுத்தப்பட்டது.\n\nநிலை: #${v.position ?? "..."}\nமதிப்பிட்ட காத்திருப்பு: ~${v.estimatedMinutes ?? "..."} நிமிடம்\n${v.locationName ? `இடம்: ${v.locationName}` : ""}\n\nஅருகில் இருங்கள். உங்கள் முறை வரும்போது உங்களுக்கு தெரிவிப்போம்.\n\n— ${v.businessName || "Quecumber"}`,

    your_turn: (v) =>
      `${v.customerName}, உங்கள் முறை வந்துவிட்டது! இப்போது கவுண்டருக்கு வாருங்கள்.\n\nடிக்கெட்: *${v.ticketNumber}*\nசேவை: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    no_show: (v) =>
      `${v.customerName}, டிக்கெட் *${v.ticketNumber}* க்கு அழைக்கப்பட்டீர்கள் ஆனால் வரவில்லை.\n\nஉங்கள் பதிவு தவறவிட்டதாக குறிக்கப்பட்டுள்ளது. சேவை தேவைப்பட்டால் மீண்டும் வரிசையில் சேரவும்.\n\n— ${v.businessName || "Quecumber"}`,

    cancelled: (v) =>
      `${v.customerName}, ${v.queueName} க்கான உங்கள் டிக்கெட் *${v.ticketNumber}* ரத்து செய்யப்பட்டது.\n\nஇது தவறாக இருந்தால், எப்போது வேண்டுமானாலும் மீண்டும் சேரலாம்.\n\n— ${v.businessName || "Quecumber"}`,

    welcome: (v) =>
      `வணக்கம் ${v.customerName}, EMFlow-க்கு உங்களை வரவேற்கிறோம்! ${v.businessName || "நாங்கள்"} உங்களுக்கு சேவை செய்ய மகிழ்ச்சியடைகிறோம்.`,

    waitlist_welcome: (v) =>
      `வணக்கம் ${v.customerName}! அதிகபட்ச வாடிக்கையாளர் எண்ணிக்கை எட்டப்பட்டது. நீங்கள் காத்திருப்புப் பட்டியலில் உள்ளீர்கள். உறுதிப்படுத்தப்பட்ட வாடிக்கையாளர்கள் யாராவது வராமல் இருந்தால் அல்லது ரத்து செய்தால், நீங்கள் அடுத்ததாகக் கருதப்படுவீர்கள்.\n\nகாத்திருப்பு எண்: *${v.ticketNumber}*\nசேவை: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    waitlist_confirmed: (v) =>
      `வாழ்த்துக்கள் ${v.customerName}! உங்கள் ஸ்லாட் உறுதிப்படுத்தப்பட்டது. உங்கள் தற்போதைய நிலை #${v.position ?? "..."} மற்றும் உங்கள் மதிப்பிடப்பட்ட காத்திருப்பு நேரம் ~${v.estimatedMinutes ?? "..."} நிமிடங்கள்.\n\nடிக்கெட்: *${v.ticketNumber}*\nசேவை: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,
  },

  ml: {
    confirmation: (v) =>
      `നമസ്കാരം ${v.customerName}! ${v.queueName} നുള്ള നിങ്ങളുടെ ടിക്കറ്റ് *${v.ticketNumber}* സ്ഥിരീകരിച്ചു.\n\nസ്ഥാനം: #${v.position ?? "..."}\nകണക്കാക്കിയ കാത്തിരിപ്പ്: ~${v.estimatedMinutes ?? "..."} മിനിറ്റ്\n${v.locationName ? `സ്ഥലം: ${v.locationName}` : ""}\n\nദയവായി സമീപത്ത് നില്‍ക്കുക. നിങ്ങളുടെ ഊഴം വരുമ്പോള്‍ അറിയിക്കും.\n\n— ${v.businessName || "Quecumber"}`,

    your_turn: (v) =>
      `${v.customerName}, നിങ്ങളുടെ ഊഴം വന്നിരിക്കുന്നു! ദയവായി ഇപ്പോള്‍ കൗണ്ടറിലേക്ക് വരൂ.\n\nടിക്കറ്റ്: *${v.ticketNumber}*\nസേവനം: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    no_show: (v) =>
      `${v.customerName}, ടിക്കറ്റ് *${v.ticketNumber}* നായി വിളിച്ചു പക്ഷേ നിങ്ങള്‍ വന്നില്ല.\n\nനിങ്ങളുടെ എന്‍ട്രി നഷ്ടപ്പെട്ടതായി അടയാളപ്പെടുത്തി. സേവനം ആവശ്യമെങ്കില്‍ വീണ്ടും ക്യൂവില്‍ ചേരുക.\n\n— ${v.businessName || "Quecumber"}`,

    cancelled: (v) =>
      `${v.customerName}, ${v.queueName} നുള്ള നിങ്ങളുടെ ടിക്കറ്റ് *${v.ticketNumber}* റദ്ദാക്കി.\n\nഇത് തെറ്റായിരുന്നെങ്കില്‍, എപ്പോള്‍ വേണമെങ്കിലും വീണ്ടും ചേരാം.\n\n— ${v.businessName || "Quecumber"}`,

    welcome: (v) =>
      `നമസ്കാരം ${v.customerName}! EMFlow-ലേക്ക് സ്വാഗതം. ${v.businessName || "ഞങ്ങൾ"} നിങ്ങളെ സേവിക്കുന്നതിൽ സന്തോഷിക്കുന്നു.`,

    waitlist_welcome: (v) =>
      `നമസ്കാരം ${v.customerName}! പരമാവധി ഉപഭോക്താക്കളുടെ എണ്ണം എത്തിക്കഴിഞ്ഞു. നിങ്ങൾ വെയിറ്റിംഗ് ലിസ്റ്റിലാണ്. സ്ഥിരീകരിച്ച ഉപഭോക്താക്കളാരെങ്കിലും വരാതിരിക്കുകയോ റദ്ദാക്കുകയോ ചെയ്താൽ, നിങ്ങളെ അടുത്തതായി പരിഗണിക്കും.\n\nവെയിറ്റിംഗ് നമ്പർ: *${v.ticketNumber}*\nസേവനം: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,

    waitlist_confirmed: (v) =>
      `അഭിനന്ദനങ്ങൾ ${v.customerName}! നിങ്ങളുടെ സ്ലോട്ട് സ്ഥിരീകരിച്ചു. നിങ്ങളുടെ നിലവിലെ സ്ഥാനം #${v.position ?? "..."} ആണ്, ഏകദേശ കാത്തിരിപ്പ് സമയം ~${v.estimatedMinutes ?? "..."} മിനിറ്റാണ്.\n\nടിക്കറ്റ്: *${v.ticketNumber}*\nസേവനം: ${v.queueName}\n\n— ${v.businessName || "Quecumber"}`,
  },
};
