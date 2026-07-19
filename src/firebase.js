// Firebase initialization — this is the one place the app connects to your real project.
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBQIyW-eyDIL3brMbtsb2hAd5lPoVZyGLM",
  authDomain: "oshe-895ad.firebaseapp.com",
  projectId: "oshe-895ad",
  storageBucket: "oshe-895ad.firebasestorage.app",
  messagingSenderId: "690790137704",
  appId: "1:690790137704:web:8f56ef4679edc85bbf20dd",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
