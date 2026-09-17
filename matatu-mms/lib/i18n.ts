export type Language = "en" | "sw";

export const LANGUAGE_STORAGE_KEY = "nccg_lang";

// This dictionary belongs to the staff app only — county staff (admin,
// enforcement, director/chief officer, viewer). The separate public app
// (passengers, crew, Sacco operators) has its own copy of this file with
// only the keys it needs.
const dictionary = {
  // Sidebar navigation
  "nav.overview": { en: "Overview", sw: "Muhtasari" },
  "nav.operatorVerification": { en: "Operator Verification", sw: "Uthibitisho wa Waendeshaji" },
  "nav.fleetRegistry": { en: "Fleet Registry", sw: "Orodha ya Magari" },
  "nav.enforcement": { en: "Enforcement", sw: "Utekelezaji wa Sheria" },
  "nav.passengerFeedback": { en: "Passenger Feedback", sw: "Maoni ya Abiria" },
  "nav.revenueFines": { en: "Revenue & Fines", sw: "Mapato na Faini" },
  "nav.routes": { en: "Routes", sw: "Njia" },
  "nav.users": { en: "Users & Roles", sw: "Watumiaji na Majukumu" },
  "nav.signOut": { en: "Sign out", sw: "Toka" },

  // Header
  "header.welcomeBack": { en: "Welcome back", sw: "Karibu tena" },

  // Footer
  "footer.contactUs": { en: "Contact Us", sw: "Wasiliana Nasi" },
  "footer.help": { en: "Help", sw: "Msaada" },
  "footer.privacyPolicy": { en: "Privacy Policy", sw: "Sera ya Faragha" },
  "footer.terms": { en: "Terms & Conditions", sw: "Sheria na Masharti" },
  "footer.rights": { en: "All rights reserved.", sw: "Haki zote zimehifadhiwa." },

  // Sign-in form
  "login.signIn": { en: "Sign in", sw: "Ingia" },
  "login.signingIn": { en: "Signing in...", sw: "Inaingia..." },
  "login.email": { en: "Email, phone, or officer/crew number", sw: "Barua pepe, nambari ya simu, au nambari ya afisa" },
  "login.password": { en: "Password", sw: "Nenosiri" },
  "login.forgotPassword": { en: "Forgot password?", sw: "Umesahau nenosiri?" },
  "login.rememberMe": { en: "Keep me signed in for 30 days", sw: "Nibaki nimeingia kwa siku 30" },
  "login.demoAccounts": { en: "Demo accounts", sw: "Akaunti za mfano" },

  // Staff sign-in ("/login") — admin, enforcement, director/chief officer, viewer
  "staff.heading": { en: "One console for licensing, enforcement, and revenue.", sw: "Dashibodi moja kwa usajili, utekelezaji wa sheria, na mapato." },
  "staff.subheading": {
    en: "Operator verification, fleet compliance, citation management, and county-wide revenue reporting for Nairobi's matatu sector, on one real-time backbone.",
    sw: "Uthibitisho wa waendeshaji, utii wa magari, usimamizi wa faini, na taarifa za mapato kwa kaunti nzima za sekta ya matatu ya Nairobi, kwenye mfumo mmoja wa wakati halisi.",
  },
  "staff.useCredentials": { en: "Use your county-issued credentials to continue.", sw: "Tumia vitambulisho vyako vya kaunti kuendelea." },
  "staff.publicLink": { en: "Looking to book a ride or manage your Sacco? Go to the public portal →", sw: "Unatafuta kuhifadhi safari au kusimamia Sacco yako? Nenda kwenye ukurasa wa umma →" },
} as const;

export type TranslationKey = keyof typeof dictionary;

export function translate(key: TranslationKey, lang: Language): string {
  return dictionary[key][lang];
}
