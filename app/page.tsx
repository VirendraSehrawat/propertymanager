"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const { role, loading } = useAuth();
  const router = useRouter();

  // Redirect based on role once logged in
  useEffect(() => {
    if (!loading) {
      if (role === "admin") router.push("/admin");
      if (role === "tenant") router.push("/tenant");
    }
  }, [role, loading, router]);

  // Handle Email Registration OR Login
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsProcessing(true);

    try {
      if (isRegistering) {
        // --- REGISTRATION LOGIC ---
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = result.user;

        // TEST RULE: If the email is admin@test.com, make them an admin.
        const assignedRole = email.toLowerCase() === "admin@test.com" ? "admin" : "tenant";

        // Save profile to Firestore
        await setDoc(doc(db, "users", user.uid), {
          name: name || "Test User",
          email: user.email,
          role: assignedRole,
          createdAt: new Date().toISOString()
        });

      } else {
        // --- LOGIN LOGIC ---
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') setError("This email is already registered.");
      else if (err.code === 'auth/weak-password') setError("Password must be at least 6 characters.");
      else if (err.code === 'auth/invalid-credential') setError("Invalid email or password.");
      else setError("Authentication failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        const assignedRole = user.email === "admin@test.com" ? "admin" : "tenant";
        await setDoc(userRef, {
          name: user.displayName || "Unknown",
          email: user.email,
          role: assignedRole,
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(err);
      setError("Google sign-in failed. Please try again.");
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-md border border-gray-200">
        <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">
          {isRegistering ? "Create an Account" : "Property Manager"}
        </h2>
        <p className="text-center text-sm text-gray-500 mb-8">
          {isRegistering ? "Register to access your portal" : "Sign in to your account"}
        </p>

        {error && <p className="bg-red-50 text-red-600 text-sm text-center p-3 rounded mb-4 border border-red-100">{error}</p>}

        <form onSubmit={handleEmailAuth} className="space-y-4">

          {isRegistering && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required={isRegistering}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isProcessing}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 transition"
          >
            {isProcessing ? "Processing..." : isRegistering ? "Register" : "Sign In"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError("");
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            {isRegistering ? "Already have an account? Sign in" : "Need an account? Register here"}
          </button>
        </div>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">Or continue with</span>
            </div>
          </div>

          <div className="mt-6">
            <button
              onClick={handleGoogleLogin}
              className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition"
            >
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