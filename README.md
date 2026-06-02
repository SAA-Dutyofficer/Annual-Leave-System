# Annual Leave System — Setup Guide

## What's included
- Staff portal: submit requests, view balance, team view, leave history
- Manager portal: Excel-style dashboard, approvals, employee management, groups, audit log
- Real-time sync via Firebase Firestore
- Offline support
- Mobile + desktop responsive
- Email notifications via Firebase emailQueue

## File structure
```
index.html          ← Login page
pages/
  staff.html        ← Staff portal
  manager.html      ← Manager dashboard
css/
  main.css          ← All styles
js/
  firebase.js       ← Firebase config
  auth.js           ← Login logic
  staff.js          ← Staff portal logic
  manager.js        ← Manager portal logic
  utils.js          ← Shared helpers
firestore.rules     ← Database security rules
```

## Step 1 — Firestore Rules
Go to Firebase Console → Firestore → Rules
Paste contents of firestore.rules → Publish

## Step 2 — Create your manager account
1. Firebase Console → Authentication → Add user → enter email + password
2. Copy the UID shown
3. Firebase Console → Firestore → Create collection: `users`
4. Document ID = your UID
5. Fields:
   - name (string): Your Name
   - email (string): your@email.com
   - role (string): manager
6. Save

## Step 3 — Deploy via GitHub Pages
1. Push all files to GitHub repo (root level)
2. Settings → Pages → main branch → Save
3. Add your GitHub Pages domain to Firebase Console → Authentication → Settings → Authorized domains

## Step 4 — Email notifications (optional)
Install Firebase Trigger Email extension:
- Firebase Console → Extensions → "Trigger Email"
- Configure with Outlook 365 SMTP:
  - Host: smtp.office365.com
  - Port: 587
  - Email: your@email.com
  - Password: your app password (generate in Microsoft account)
- Set collection to watch: emailQueue

## Adding employees
Log in as manager → Employees tab → Add Employee
Fill in name, email, department, pattern (DO only), joining date, cycle start, entitlement
The employee can log in immediately with the password you set.

## Shift patterns
- DO Staff: enter pattern like 6W4O (6 work days, 4 off) or 3W3O
- GD Staff: automatically Mon–Thu working days, no pattern needed

## Groups
Groups tab → Create group → then assign employees via Edit Employee
Staff can see their group members' availability in the Team tab
