# Hackathon Leaderboard — Firebase Edition

A real-time hackathon leaderboard built with React, Vite, Firebase Authentication, and Cloud Firestore.

## Features

- Public live leaderboard at `/`
- Admin login at `/admin`
- Add, edit and delete teams
- Automatic ranking from highest score to lowest
- Tied teams share the same rank
- Firestore real-time updates
- CSV export
- PDF export
- Search teams
- Clear-all controls
- Responsive UI suitable for projector screens
- Firebase Hosting-ready configuration

## 1. Install

From the project root:

```bash
npm install
npm run install:all
```

## 2. Create a Firebase project

Go to the Firebase Console and create a project.

Enable:

1. Authentication → Sign-in method → Email/Password
2. Firestore Database → Create database
3. Project Settings → Your apps → Web app

Copy the web-app configuration values into `client/.env` using `client/.env.example`.

Example:

```env
VITE_EVENT_NAME=ZENSYRA'26 Hackathon Leaderboard
VITE_MAX_MARKS=100
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 3. Create the admin account

In Firebase Console:

Authentication → Users → Add user.

Create the organizer's email and password.

Copy the user's UID.

In Firestore, create this document:

```text
admins/{ADMIN_USER_UID}
```

with this field:

```text
role: "admin"
```

The `admins` collection is intentionally unreadable and unwritable from the website. Create or manage it only from the Firebase Console or trusted server-side tooling.

## 4. Apply Firestore rules

The included `firestore.rules` makes:

- `teams`: public read, admin-only write
- `admins`: no client access

Deploy with Firebase CLI if desired:

```bash
firebase login
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore:rules
```

## 5. Run locally

From the project root:

```bash
npm run dev
```

Open:

- Public: http://localhost:5173/
- Admin: http://localhost:5173/admin

## 6. Deploy to Firebase Hosting

Install the CLI once if needed:

```bash
npm install -g firebase-tools
```

Build the client:

```bash
npm run build
```

Login and select your project:

```bash
firebase login
firebase use YOUR_FIREBASE_PROJECT_ID
```

Deploy rules and hosting:

```bash
firebase deploy --only firestore:rules,hosting
```

## Important security note

Do not put Firebase Admin SDK service-account credentials in the React app. The browser only receives the normal Firebase Web App configuration. Firestore Security Rules enforce write access.

## Data model

Collection: `teams`

```text
teams/{teamId}
  name: string
  nameNormalized: string
  marks: number
  createdAt: timestamp
  updatedAt: timestamp
```

Collection: `admins`

```text
admins/{firebaseAuthUid}
  role: "admin"
```
