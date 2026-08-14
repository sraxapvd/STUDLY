const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const { sessionUser } = require('./api');

const router = express.Router();

/* =========================
   VERIFY LINE SIGNATURE
========================= */

function verifySignature(req) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  const signature = req.headers['x-line-signature'];

  if (!secret || !signature || !req.rawBody) {
    return false;
  }

  const hash = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('base64');

  if (hash.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}

/* =========================
   LINE PUSH MESSAGE
========================= */

async function linePush(to, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
  }

  const response = await fetch(
    'https://api.line.me/v2/bot/message/push',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to,
        messages
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE API ${response.status}: ${body}`);
  }

  return true;
}

/* =========================
   LINE WEBHOOK
========================= */

router.post('/webhook', async (req, res) => {

  /*
   * ตรวจสอบว่า Webhook มาจาก LINE จริง
   */
  if (!verifySignature(req)) {
    console.error('LINE webhook: invalid signature');
    return res.status(401).send('invalid signature');
  }

  /*
   * ตอบ LINE ก่อน เพื่อไม่ให้ Webhook timeout
   */
  res.status(200).json({
    ok: true
  });

  try {

    for (const event of req.body.events || []) {

      /* =========================
         TEXT MESSAGE
      ========================= */

      if (
        event.type === 'message' &&
        event.message?.type === 'text'
      ) {

        const text = event.message.text.trim();

        const db = store.read();

        /*
         * ตรวจ Link Code
         */

        const code = db.linkCodes.find(
          item =>
            item.code === text &&
            !item.used &&
            new Date(item.expiresAt) > new Date()
        );

        /* =========================
           LINK CODE FOUND
        ========================= */

        if (code) {

          const student = db.users.find(
            user => user.id === code.studentId
          );

          if (!student) {
            continue;
          }

          store.update(data => {

            const currentCode =
              data.linkCodes.find(
                item => item.code === code.code
              );

            if (currentCode) {
              currentCode.used = true;
            }

            data.parentConnections =
              data.parentConnections.filter(
                item => item.studentId !== student.id
              );

            data.parentConnections.push({
              studentId: student.id,
              lineUserId: event.source.userId,
              connectedAt: new Date().toISOString(),
              relationship: 'parent',
              status: 'PENDING_CONFIRMATION'
            });

            return data;
          });

          /*
           * ส่งข้อความยืนยันให้ผู้ปกครอง
           */

          await linePush(
            event.source.userId,
            [
              {
                type: 'template',
                altText: 'ยืนยันการเชื่อมต่อ STUDLY',
                template: {
                  type: 'confirm',
                  text:
                    `พบคำขอเชื่อมต่อกับบัญชีของ ${student.name} ต้องการเชื่อมต่อเป็นผู้ปกครองหรือไม่?`,
                  actions: [
                    {
                      type: 'postback',
                      label: 'ยืนยันการเชื่อมต่อ',
                      data: `confirm:${student.id}`
                    },
                    {
                      type: 'message',
                      label: 'ยกเลิก',
                      text: 'ยกเลิกการเชื่อมต่อ'
                    }
                  ]
                }
              }
            ]
          );
        }

        /* =========================
           CONFIRM TEXT
        ========================= */

        else if (text.startsWith('confirm:')) {

          const studentId = text.split(':')[1];

          store.update(data => {

            const connection =
              data.parentConnections.find(
                item =>
                  item.studentId === studentId &&
                  item.lineUserId === event.source.userId
              );

            if (connection) {
              connection.status = 'CONNECTED';
            }

            return data;
          });

          await linePush(
            event.source.userId,
            [
              {
                type: 'text',
                text: '🟢 เชื่อมต่อ STUDLY สำเร็จแล้ว'
              }
            ]
          );
        }
      }

      /* =========================
         POSTBACK CONFIRM
      ========================= */

      if (
        event.type === 'postback' &&
        event.postback?.data?.startsWith('confirm:')
      ) {

        const studentId =
          event.postback.data.split(':')[1];

        store.update(data => {

          const connection =
            data.parentConnections.find(
              item =>
                item.studentId === studentId &&
                item.lineUserId === event.source.userId
            );

          if (connection) {
            connection.status = 'CONNECTED';
          }

          return data;
        });

        await linePush(
          event.source.userId,
          [
            {
              type: 'text',
              text: '🟢 เชื่อมต่อ STUDLY สำเร็จแล้ว'
            }
          ]
        );
      }
    }

  } catch (error) {

    console.error(
      'LINE webhook processing error:',
      error
    );

  }
});

/* =========================
   SEND TEST MESSAGE
========================= */

router.post('/send-message', async (req, res) => {

  const token =
    (req.headers.authorization || '')
      .replace('Bearer ', '');

  const user = sessionUser(token);

  if (!user || user.role !== 'student') {
    return res.status(403).json({
      error: 'ไม่มีสิทธิ์'
    });
  }

  const db = store.read();

  const connection =
    db.parentConnections.find(
      item =>
        item.studentId === user.id &&
        item.status === 'CONNECTED'
    );

  if (!connection) {
    return res.status(400).json({
      error: 'ยังไม่ได้เชื่อมต่อ LINE ผู้ปกครอง'
    });
  }

  try {

    await linePush(
      connection.lineUserId,
      [
        {
          type: 'text',
          text:
            '🎓 STUDLY\n' +
            'นี่คือข้อความทดสอบจากระบบ STUDLY\n' +
            'การเชื่อมต่อ LINE สำเร็จแล้ว'
        }
      ]
    );

    res.json({
      ok: true,
      message: 'ส่งข้อความทดสอบสำเร็จ'
    });

  } catch (error) {

    console.error(
      'LINE test message error:',
      error
    );

    res.status(500).json({
      error:
        'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบการตั้งค่า LINE'
    });
  }
});

/* =========================
   SMART ALERT
========================= */

async function sendSmartAlert(studentId) {

  const db = store.read();

  const connection =
    db.parentConnections.find(
      item =>
        item.studentId === studentId &&
        item.status === 'CONNECTED'
    );

  if (!connection) {
    throw new Error('No connected parent');
  }

  const physics =
    db.subjects.find(
      subject => subject.name === 'Physics'
    );

  await linePush(
    connection.lineUserId,
    [
      {
        type: 'text',
        text:
          `🔴 STUDLY Smart Alert\n` +
          `แจ้งเตือนการเรียนของน้องสมชาย\n` +
          `Physics มีความเสี่ยงสูง\n` +
          `คะแนนปัจจุบัน: ${physics?.score || 42}%\n` +
          `งานสำคัญใกล้ Deadline: 1 งาน\n` +
          `แนะนำให้ช่วยน้องวางแผนการทำงาน`
      }
    ]
  );
}

/* =========================
   SMART ALERT API
========================= */

router.post('/smart-alert', async (req, res) => {

  const token =
    (req.headers.authorization || '')
      .replace('Bearer ', '');

  const user = sessionUser(token);

  if (!user || user.role !== 'student') {
    return res.status(403).json({
      error: 'ไม่มีสิทธิ์'
    });
  }

  try {

    await sendSmartAlert(user.id);

    res.json({
      ok: true,
      message: 'ส่ง Smart Alert สำเร็จ'
    });

  } catch (error) {

    console.error(
      'LINE Smart Alert error:',
      error
    );

    res.status(500).json({
      error:
        'ไม่สามารถส่ง Smart Alert ได้ กรุณาตรวจสอบการตั้งค่า LINE'
    });
  }
});

module.exports = {
  router
};
