import express, { Request, Response } from "express";
import admin, { ServiceAccount } from "firebase-admin";
import dotenv from "dotenv";

// Initialize dotenv
dotenv.config();

const app = express();

const { SERVICE_KEY, VERIFY_TOKEN, FIREBASE_PROJECT_ID } = process.env;

const key = (): ServiceAccount | null => {
  if (SERVICE_KEY) {
    try {
      const serviceKey = JSON.parse(SERVICE_KEY);
      return {
        projectId: serviceKey?.project_id,
        clientEmail: serviceKey?.client_email,
        privateKey: serviceKey?.private_key,
      };
    } catch (error) {
      console.log(error, "key parse error");
      return null;
    }
  } else {
    return null;
  }
};

const finalServiceKey = key();

if (finalServiceKey) {
  admin.initializeApp({
    credential: admin.credential.cert(finalServiceKey),
    projectId: FIREBASE_PROJECT_ID,
  });

  const db = admin.firestore();
  app.use(express.json());

  // Webhook verification
  app.get("/webhook", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      res.status(200).send(challenge as string);
    } else {
      res.sendStatus(403);
    }
  });

  app.post("/webhook", async (req: Request, res: Response) => {
    const body = req.body;

    if (!body?.entry) {
      return res.sendStatus(404);
    }

    const status = body.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];

    if (!status) {
      return res.sendStatus(200);
    }

    const messageId = status.id;
    const recipientId = status.recipient_id;
    const messageStatus = status.status;
    const timestamp = status.timestamp;
    const errors = status.errors?.[0] ?? null;

    try {
      const messageDoc = await db
        .collection("whatsappLogs")
        .where("messageId", "==", messageId)
        .get();

      if (messageDoc.empty) {
        console.log("❌ No existing document found for messageId:", messageId);
        return res.sendStatus(200);
      }

      const docSnapshot = messageDoc.docs[0];
      const docRef = docSnapshot.ref;

      // Get the existing checkoutId from the document
      const checkoutId = docSnapshot.data().checkoutId;

      const date = new Date(Number(timestamp) * 1000); // Convert to milliseconds

      // Format the time to AM/PM format
      const options: Intl.DateTimeFormatOptions = {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true, // AM/PM format
      };

      const timeInAmPmFormat = new Intl.DateTimeFormat("en-US", options).format(
        date
      );

      await docRef.update({
        checkoutId,
        messageId,
        recipientId,
        status: messageStatus,
        formattedTime: timeInAmPmFormat, // Store the time in AM/PM format
        errorCode: errors?.code ?? null,
        errorMessage: errors?.message ?? null,
        errorDetails: errors?.error_data?.details ?? null,
      });

      console.log(
        `✅ Updated status for messageId: ${messageId} to "${messageStatus}" for checkoutId: ${checkoutId}`
      );

      res.sendStatus(200);
    } catch (error) {
      console.error("❌ Error processing webhook status:", error);
      res.sendStatus(500);
    }
  });

  const PORT = process.env.PORT ?? 4000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}
