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

  // Login page
  "login.heading": { en: "One county, one live view of every matatu.", sw: "Kaunti moja, mwonekano mmoja wa moja kwa moja wa kila matatu." },
  "login.subheading": {
    en: "Fleet registration, live GPS telemetry, seat booking, fare compliance and enforcement, all on one real-time backbone connecting officers, operators, crew and commuters. Smart and connected mobility for the whole county.",
    sw: "Usajili wa magari, ufuatiliaji wa GPS wa moja kwa moja, uhifadhi wa viti, utii wa nauli na utekelezaji wa sheria, yote kwenye mfumo mmoja wa wakati halisi unaounganisha maafisa, waendeshaji, wafanyakazi na abiria. Usafiri wenye akili na uunganisho kwa kaunti nzima.",
  },
  "login.signIn": { en: "Sign in", sw: "Ingia" },
  "login.signingIn": { en: "Signing in...", sw: "Inaingia..." },
  "login.useCredentials": { en: "Use your county-issued credentials to continue.", sw: "Tumia vitambulisho vyako vya kaunti kuendelea." },
  "login.email": { en: "Email", sw: "Barua pepe" },
  "login.password": { en: "Password", sw: "Nenosiri" },
  "login.forgotPassword": { en: "Forgot password?", sw: "Umesahau nenosiri?" },
  "login.registerLink": { en: "New here? Register as Commuter or Matatu Crew →", sw: "Mgeni hapa? Jisajili kama Abiria au Wafanyakazi wa Matatu →" },
  "login.onboardingLink": { en: "Operator? Start Onboarding & Verification →", sw: "Mwendeshaji? Anza Usajili na Uthibitisho →" },
  "login.demoAccounts": { en: "Demo accounts", sw: "Akaunti za mfano" },
  "login.helpFaq": { en: "Help & FAQ", sw: "Msaada na Maswali" },
  "login.termsConditions": { en: "Terms & Conditions", sw: "Sheria na Masharti" },
} as const;

export type TranslationKey = keyof typeof dictionary;

export function translate(key: TranslationKey, lang: Language): string {
  return dictionary[key][lang];
}
