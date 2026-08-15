export type Language = "en" | "sw";

export const LANGUAGE_STORAGE_KEY = "nccg_lang";

// A focused dictionary covering shared app chrome (sidebar, header, footer)
// and the highest-traffic public pages (login), rather than every string in
// the app — the pieces every user sees regardless of role or page.
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
  "nav.operatorDashboard": { en: "Operator Dashboard", sw: "Dashibodi ya Mwendeshaji" },
  "nav.passengerPortal": { en: "Passenger Portal", sw: "Ukurasa wa Abiria" },
  "nav.crewDashboard": { en: "Crew Dashboard", sw: "Dashibodi ya Wafanyakazi" },
  "nav.signOut": { en: "Sign out", sw: "Toka" },

  // Header
  "header.welcomeBack": { en: "Welcome back", sw: "Karibu tena" },

  // Footer
  "footer.contactUs": { en: "Contact Us", sw: "Wasiliana Nasi" },
  "footer.help": { en: "Help", sw: "Msaada" },
  "footer.privacyPolicy": { en: "Privacy Policy", sw: "Sera ya Faragha" },
  "footer.terms": { en: "Terms & Conditions", sw: "Sheria na Masharti" },
  "footer.rights": { en: "All rights reserved.", sw: "Haki zote zimehifadhiwa." },

  // Shared sign-in form (used by both the public portal and staff sign-in)
  "login.signIn": { en: "Sign in", sw: "Ingia" },
  "login.signingIn": { en: "Signing in...", sw: "Inaingia..." },
  "login.email": { en: "Email", sw: "Barua pepe" },
  "login.password": { en: "Password", sw: "Nenosiri" },
  "login.forgotPassword": { en: "Forgot password?", sw: "Umesahau nenosiri?" },
  "login.demoAccounts": { en: "Demo accounts", sw: "Akaunti za mfano" },
  "login.helpFaq": { en: "Help & FAQ", sw: "Msaada na Maswali" },
  "login.termsConditions": { en: "Terms & Conditions", sw: "Sheria na Masharti" },

  // Public portal ("/") — passengers, crew (info only, no self-registration), sacco operators
  "portal.heading": { en: "One county, one live view of every matatu.", sw: "Kaunti moja, mwonekano mmoja wa moja kwa moja wa kila matatu." },
  "portal.subheading": {
    en: "Book a seat, track your matatu live, check your fare, or register your Sacco for county verification. Smart and connected mobility for the whole county.",
    sw: "Hifadhi kiti, fuatilia matatu yako moja kwa moja, angalia nauli yako, au sajili Sacco yako kwa uthibitisho wa kaunti. Usafiri wenye akili na uunganisho kwa kaunti nzima.",
  },
  "portal.useCredentials": { en: "Sign in to book, manage your fleet, or check your account.", sw: "Ingia ili kuhifadhi, kusimamia magari yako, au kuangalia akaunti yako." },
  "portal.registerLink": { en: "New here? Register as a Commuter →", sw: "Mgeni hapa? Jisajili kama Abiria →" },
  "portal.onboardingLink": { en: "Operator? Start Onboarding & Verification →", sw: "Mwendeshaji? Anza Usajili na Uthibitisho →" },
  "portal.staffLink": { en: "County staff? Sign in to the internal portal →", sw: "Wafanyakazi wa kaunti? Ingia kwenye ukurasa wa ndani →" },

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
