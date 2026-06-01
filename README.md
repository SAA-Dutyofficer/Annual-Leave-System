# Annual Leave Management System

A web-based leave management system built with Firebase and vanilla HTML/CSS/JS.

## Features
- Staff login and leave request submission
- Manager approval/rejection with email notifications
- DO Staff (shift pattern) and GD Staff (Mon-Thu) support
- Clash detection
- Leave cycle renewal
- Real-time dashboard
- Mobile and desktop friendly

## Project Structure
```
annual-leave-system/
├── index.html          # Login page
├── pages/
│   ├── staff.html      # Staff portal
│   └── manager.html    # Manager dashboard
├── css/
│   └── style.css       # All styles
├── js/
│   ├── firebase.js     # Firebase config
│   ├── auth.js         # Login logic
│   ├── staff.js        # Staff portal logic
│   ├── manager.js      # Manager portal logic
│   └── utils.js        # Shared utilities
├── firestore.rules     # Database security rules
└── firebase.json       # Firebase hosting config
```

## Setup Steps

### 1. Firebase Setup
- Create Firebase project at firebase.google.com
- Enable Authentication (Email/Password)
- Create Firestore Database (start in test mode)
- Enable Hosting

### 2. Deploy Security Rules
In Firebase Console → Firestore → Rules, paste the contents of `firestore.rules`

### 3. Create First Manager Account
In Firebase Console → Authentication → Add user
Then in Firestore → users collection → add document with the user's UID:
```json
{
  "name": "Manager Name",
  "email": "manager@example.com",
  "role": "manager"
}
```

### 4. Deploy to Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

### 5. Email Notifications (Optional)
Install the Firebase Trigger Email extension in Firebase Console
Configure with your Outlook 365 SMTP settings:
- Host: smtp.office365.com
- Port: 587
- Email: your-email@domain.com
- Password: your-app-password

## Roles
- **Manager**: Can add/remove employees, approve/reject requests, renew cycles, see full dashboard
- **Staff**: Can submit leave requests, see own balance and request history

## Leave Types
- **DO Staff**: Shift pattern based (e.g. 6W4O = 6 days work, 4 days off)
- **GD Staff**: Standard Mon-Thu working days
