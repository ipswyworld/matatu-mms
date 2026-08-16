export type Language = "en" | "sw";

export const LANGUAGE_STORAGE_KEY = "nccg_lang";

// A focused dictionary covering shared app chrome (sidebar, header, footer)
// and the highest-traffic public pages (login), rather than every string in
// the app — the pieces every user sees regardless of role or page.
// This dictionary belongs to the public-facing app only (passengers, crew,
// Sacco operators) — county staff strings live in the separate staff app's
// own copy of this file.
const dictionary = {
  // Sidebar navigation
  "nav.fleetRegistry": { en: "Fleet Registry", sw: "Orodha ya Magari" },
  "nav.revenueFines": { en: "Revenue & Fines", sw: "Mapato na Faini" },
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

  // Sign-in form
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
} as const;

export type TranslationKey = keyof typeof dictionary;

export function translate(key: TranslationKey, lang: Language): string {
  return dictionary[key][lang];
}
