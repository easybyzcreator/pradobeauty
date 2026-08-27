// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, CACHE_SIZE_UNLIMITED } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDWzHtITyJYZRzvh4C3G6xab5bLVrCQ8V0",
  authDomain: "prado-beauty-76d21.firebaseapp.com",
  projectId: "prado-beauty-76d21",
  storageBucket: "prado-beauty-76d21.firebasestorage.app",
  messagingSenderId: "795996166548",
  appId: "1:795996166548:web:b00ac32e14edebf7de1781",
  measurementId: "G-VL6LXG61WD"
};

// Initialize Firebase with re-initialization check
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with specific settings to avoid common sandbox assertion errors
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export const auth = getAuth(app);

// Analytics only if supported
export const analytics = typeof window !== 'undefined' ? 
  isSupported().then(yes => yes ? getAnalytics(app) : null) : 
  null;
