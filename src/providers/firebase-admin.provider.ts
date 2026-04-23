import * as admin from 'firebase-admin';
import { FIREBASE_ADMIN } from 'src/constant/providers.constant';

export default {
  provide: FIREBASE_ADMIN,
  useFactory: () => {
    if (!admin.apps.length) {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const rawKey = process.env.FIREBASE_PRIVATE_KEY;
      if (!projectId || !clientEmail || !rawKey) {
        throw new Error(
          'Firebase Admin: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (PEM, use \\n for newlines in .env)',
        );
      }
      return admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: rawKey.replace(/\\n/g, '\n'),
        }),
      });
    }
    return admin.app();
  },
};
