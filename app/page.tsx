"use client";

import { useState, useEffect } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

console.log("My API Key is:", process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
export default function LoginPage() {
  // Auth Modes: 'email' | 'phone'
  const [authMode, setAuthMode] = useState<"email" | "phone">("email");
  const [isRegistering, setIsRegistering] = useState(false);

  // Form States
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");

  // Flow States
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const { role, loading } = useAuth();
  const router = useRouter();

  // Redirect based on role once logged in
  useEffect(() => {
    if (!loading) {
      if (role === "admin") router.push("/admin");
      if (role === "tenant") router.push("/tenant");
      if (role === "employee") router.push("/employee");
    }
  }, [role, loading, router]);

  // --- EMAIL & PASSWORD LOGIC ---
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsProcessing(true);

    try {
      if (isRegistering) {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = result.user;

        const emailLower = email.toLowerCase();
        let assignedRole = "tenant";
        if (emailLower === "admin@test.com") assignedRole = "admin";
        if (emailLower === "employee@test.com") assignedRole = "employee";

        await setDoc(doc(db, "users", user.uid), {
          name: name || "Test User",
          email: user.email,
          role: assignedRole,
          createdAt: new Date().toISOString()
        });

      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') setError("This email is already registered.");
      else if (err.code === 'auth/invalid-credential') setError("Invalid email or password.");
      else setError("Authentication failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- PHONE AUTH LOGIC ---
  const setupRecaptcha = () => {
    if (!(window as any).recaptchaVerifier) {
      (window as any).recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsProcessing(true);

    // Basic validation to ensure a country code is included
    if (!phoneNumber.startsWith("+")) {
      setError("Please include your country code (e.g., +91 for India).");
      setIsProcessing(false);
      return;
    }

    try {
      setupRecaptcha();
      const appVerifier = (window as any).recaptchaVerifier;
      const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);

      // Store the confirmation object on the window to use it in the next step
      (window as any).confirmationResult = confirmationResult;
      setIsOtpSent(true);
    } catch (err: any) {
      console.error(err);
      setError("Failed to send OTP. Please check the phone number.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsProcessing(true);

    try {
      const confirmationResult = (window as any).confirmationResult;
      const result = await confirmationResult.confirm(otp);
      const user = result.user;

      // Check if user exists in Firestore, if not create a default Tenant profile
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          name: "Phone User",
          phone: user.phoneNumber,
          role: "tenant", // Default to tenant
          createdAt: new Date().toISOString()
        });
      }
    } catch (err: any) {
      console.error(err);
      setError("Invalid OTP. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- GOOGLE LOGIC ---
  const handleGoogleLogin = async () => {
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        const emailLower = user.email?.toLowerCase() || "";
        let assignedRole = "tenant";
        if (emailLower === "admin@test.com") assignedRole = "admin";
        if (emailLower === "employee@test.com") assignedRole = "employee";

        await setDoc(userRef, {
          name: user.displayName || "Unknown",
          email: user.email,
          role: assignedRole,
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      setError("Google sign-in failed. Please try again.");
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">

      {/* Invisible container required by Firebase for Phone Auth */}
      <div id="recaptcha-container"></div>

      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-md border border-gray-200">
        <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">
          {authMode === "email" ? (isRegistering ? "Create an Account" : "Property Manager") : "Login with Phone"}
        </h2>
        <p className="text-center text-sm text-gray-500 mb-6">
          {authMode === "email"
            ? (isRegistering ? "Register to access your portal" : "Sign in to your account")
            : "We will send you a 6-digit OTP to verify your number."}
        </p>

        {/* Toggle Auth Mode */}
        <div className="flex bg-gray-100 p-1 rounded-md mb-6">
          <button
            onClick={() => { setAuthMode("email"); setError(""); }}
            className={`flex-1 py-1.5 text-sm font-medium rounded ${authMode === 'email' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Email
          </button>
          <button
            onClick={() => { setAuthMode("phone"); setError(""); }}
            className={`flex-1 py-1.5 text-sm font-medium rounded ${authMode === 'phone' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Phone Number
          </button>
        </div>

        {error && <p className="bg-red-50 text-red-600 text-sm text-center p-3 rounded mb-4 border border-red-100">{error}</p>}

        {/* --- EMAIL FORM --- */}
        {authMode === "email" && (
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isRegistering && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" required={isRegistering} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
            </div>
            <button type="submit" disabled={isProcessing} className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400">
              {isProcessing ? "Processing..." : isRegistering ? "Register" : "Sign In"}
            </button>
            <div className="mt-4 text-center">
              <button type="button" onClick={() => { setIsRegistering(!isRegistering); setError(""); }} className="text-sm text-blue-600 hover:underline">
                {isRegistering ? "Already have an account? Sign in" : "Need an account? Register here"}
              </button>
            </div>
          </form>
        )}

        {/* --- PHONE FORM --- */}
        {authMode === "phone" && (
          <div className="space-y-4">
            {!isOtpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (with country code)</label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+91 99999 99999"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono"
                    required
                  />
                </div>
                <button type="submit" disabled={isProcessing} className="w-full py-2 px-4 rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-green-400">
                  {isProcessing ? "Sending OTP..." : "Send OTP"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="bg-green-50 p-3 rounded border border-green-200 mb-4 text-sm text-green-800 text-center">
                  OTP sent to {phoneNumber}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Enter 6-Digit OTP</label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="123456"
                    maxLength={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-center tracking-widest font-mono text-lg"
                    required
                  />
                </div>
                <button type="submit" disabled={isProcessing} className="w-full py-2 px-4 rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400">
                  {isProcessing ? "Verifying..." : "Verify & Login"}
                </button>
                <button type="button" onClick={() => setIsOtpSent(false)} className="w-full py-2 text-sm text-gray-500 hover:underline">
                  Change Phone Number
                </button>
              </form>
            )}
          </div>
        )}

        {/* --- GOOGLE OAUTH --- */}
        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300" /></div>
            <div className="relative flex justify-center text-sm"><span className="px-2 bg-white text-gray-500">Or continue with</span></div>
          </div>
          <div className="mt-6">
            <button onClick={handleGoogleLogin} className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}