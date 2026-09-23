# Firebase Console Setup

## A. Create project
Firebase Console → Add project.

## B. Enable email/password login
Authentication → Sign-in method → Email/Password → Enable.

## C. Create Firestore
Firestore Database → Create database.

For this hackathon app, start in production mode and deploy the included rules.

## D. Register web app
Project settings → General → Your apps → Web → Register app.

Copy these values to `client/.env`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## E. Create admin user
Authentication → Users → Add user.

Use the email and password you want judges to use.

Copy the generated UID.

## F. Mark user as admin
Firestore → Start collection → `admins`

Document ID = the Firebase Auth UID.

Field:

```text
role = admin
```

## G. Deploy rules
From the project root:

```bash
firebase login
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules
```

## H. Run

```bash
npm install
npm run install:all
npm run dev
```
