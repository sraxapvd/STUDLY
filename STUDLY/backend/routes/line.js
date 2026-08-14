const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const { sessionUser } = require('./api');

const router = express.Router();

/* =====================================================
   VERIFY LINE SIGNATURE
===================================================== */

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

/* =====================================================
   LINE PUSH MESSAGE
===================================================== */

async function linePush(to, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN'
    );
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

    throw new Error(
      `LINE API ${response.status}: ${body}`
    );
  }

  return true;
}

/* =====================================================
   GET CURRENT STUDENT
===================================================== */

function getStudentFromRequest(req) {
  const token =
    (req.headers.authorization || '')
      .replace('Bearer ', '');

  const user = sessionUser(token);

  if (!user || user.role !== 'student') {
    return null;
  }

  return user;
}

/* =====================================================
   GET CONNECTED PARENT
===================================================== */

function getConnectedParent(studentId) {
  const db = store.read();

  return db.parentConnections.find(
    item =>
      item.studentId === studentId &&
      item.status === 'CONNECTED'
  );
}

/* =====================================================
   LINE WEBHOOK
===================================================== */

router.post('/webhook', async (req, res) => {

  /*
   * LINE ต้องได้รับ HTTP 200 อย่างรวดเร็ว
   */
  if (!verifySignature(req)) {
    console.error(
      'LINE webhook: invalid signature'
    );

    return res
      .status(401)
      .send('invalid signature');
  }

  res.status(200).json({
    ok: true
  });

  try {

    for (const event of req.body.events || []) {

      const lineUserId =
        event.source?.userId;

      if (!lineUserId) {
        continue;
      }

      /* =================================================
         TEXT MESSAGE
      ================================================= */

      if (
        event.type === 'message' &&
        event.message?.type === 'text'
      ) {

        const text =
          event.message.text.trim();

        const db = store.read();

        /* ===============================================
           LINK CODE
        =============================================== */

        const code =
          db.linkCodes.find(
            item =>
              item.code === text &&
              !item.used &&
              new Date(item.expiresAt) > new Date()
          );

        if (code) {

          const student =
            db.users.find(
              user =>
                user.id === code.studentId
            );

          if (!student) {
            continue;
          }

          store.update(data => {

            const currentCode =
              data.linkCodes.find(
                item =>
                  item.code === code.code
              );

            if (currentCode) {
              currentCode.used = true;
            }

            data.parentConnections =
              data.parentConnections.filter(
                item =>
                  item.studentId !== student.id
              );

            data.parentConnections.push({
              studentId: student.id,
              lineUserId,
              connectedAt:
                new Date().toISOString(),
              relationship: 'parent',
              status:
                'PENDING_CONFIRMATION'
            });

            return data;
          });

          await linePush(
            lineUserId,
            [
              {
                type: 'template',
                altText:
                  'ยืนยันการเชื่อมต่อ STUDLY',

                template: {
                  type: 'confirm',

                  text:
                    `พบคำขอเชื่อมต่อกับบัญชีของ ${student.name} ` +
                    `ต้องการเชื่อมต่อเป็นผู้ปกครองหรือไม่?`,

                  actions: [
                    {
                      type: 'postback',
                      label:
                        'ยืนยันการเชื่อมต่อ',

                      data:
                        `confirm:${student.id}`
                    },

                    {
                      type: 'postback',
                      label: 'ยกเลิก',

                      data:
                        `cancel_connect:${student.id}`
                    }
                  ]
                }
              }
            ]
          );

          continue;
        }

        /* ===============================================
           TEXT CONFIRM CONNECT
        =============================================== */

        if (text.startsWith('confirm:')) {

          const studentId =
            text.split(':')[1];

          store.update(data => {

            const connection =
              data.parentConnections.find(
                item =>
                  item.studentId === studentId &&
                  item.lineUserId === lineUserId
              );

            if (connection) {
              connection.status =
                'CONNECTED';

              connection.connectedAt =
                connection.connectedAt ||
                new Date().toISOString();
            }

            return data;
          });

          await linePush(
            lineUserId,
            [
              {
                type: 'text',
                text:
                  '🟢 เชื่อมต่อ STUDLY สำเร็จแล้ว'
              }
            ]
          );

          continue;
        }

        /* ===============================================
           TEXT CANCEL CONNECT
        =============================================== */

        if (text.startsWith('cancel_connect:')) {

          const studentId =
            text.split(':')[1];

          store.update(data => {

            const connection =
              data.parentConnections.find(
                item =>
                  item.studentId === studentId &&
                  item.lineUserId === lineUserId
              );

            if (connection) {
              connection.status =
                'DISCONNECTED';
            }

            return data;
          });

          await linePush(
            lineUserId,
            [
              {
                type: 'text',
                text:
                  'ยกเลิกการเชื่อมต่อ STUDLY แล้ว'
              }
            ]
          );

          continue;
        }
      }

      /* =================================================
         POSTBACK
      ================================================= */

      if (
        event.type === 'postback' &&
        event.postback?.data
      ) {

        const data =
          event.postback.data;

        /* ===============================================
           CONFIRM CONNECTION
        =============================================== */

        if (
          data.startsWith('confirm:')
        ) {

          const studentId =
            data.split(':')[1];

          store.update(db => {

            const connection =
              db.parentConnections.find(
                item =>
                  item.studentId === studentId &&
                  item.lineUserId === lineUserId
              );

            if (connection) {
              connection.status =
                'CONNECTED';

              connection.connectedAt =
                connection.connectedAt ||
                new Date().toISOString();
            }

            return db;
          });

          await linePush(
            lineUserId,
            [
              {
                type: 'text',
                text:
                  '🟢 เชื่อมต่อ STUDLY สำเร็จแล้ว'
              }
            ]
          );

          continue;
        }

        /* ===============================================
           CANCEL CONNECTION
        =============================================== */

        if (
          data.startsWith('cancel_connect:')
        ) {

          const studentId =
            data.split(':')[1];

          store.update(db => {

            const connection =
              db.parentConnections.find(
                item =>
                  item.studentId === studentId &&
                  item.lineUserId === lineUserId
              );

            if (connection) {
              connection.status =
                'DISCONNECTED';
            }

            return db;
          });

          await linePush(
            lineUserId,
            [
              {
                type: 'text',
                text:
                  'ยกเลิกการเชื่อมต่อ STUDLY แล้ว'
              }
            ]
          );

          continue;
        }

        /* ===============================================
           DISCONNECT CONFIRM
        =============================================== */

        if (
          data.startsWith(
            'disconnect_confirm:'
          )
        ) {

          const studentId =
            data.split(':')[1];

          store.update(db => {

            const connection =
              db.parentConnections.find(
                item =>
                  item.studentId === studentId &&
                  item.lineUserId === lineUserId
              );

            if (connection) {

              connection.status =
                'DISCONNECTED';

              connection.disconnectedAt =
                new Date().toISOString();
            }

            return db;
          });

          await linePush(
            lineUserId,
            [
              {
                type: 'text',
                text:
                  '🔴 ยกเลิกการเชื่อมต่อ STUDLY เรียบร้อยแล้ว'
              }
            ]
          );

          continue;
        }

        /* ===============================================
           DISCONNECT CANCEL
        =============================================== */

        if (
          data.startsWith(
            'disconnect_cancel:'
          )
        ) {

          await linePush(
            lineUserId,
            [
              {
                type: 'text',
                text:
                  '🟢 ยังคงเชื่อมต่อ STUDLY อยู่'
              }
            ]
          );

          continue;
        }
      }
    }

  } catch (error) {

    console.error(
      'LINE webhook processing error:',
      error
    );
  }
});

/* =====================================================
   SEND TEST MESSAGE
===================================================== */

router.post(
  '/send-message',
  async (req, res) => {

    const user =
      getStudentFromRequest(req);

    if (!user) {
      return res.status(403).json({
        error: 'ไม่มีสิทธิ์'
      });
    }

    const connection =
      getConnectedParent(user.id);

    if (!connection) {
      return res.status(400).json({
        error:
          'ยังไม่ได้เชื่อมต่อ LINE ผู้ปกครอง'
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

      return res.json({
        ok: true,
        message:
          'ส่งข้อความทดสอบสำเร็จ'
      });

    } catch (error) {

      console.error(
        'LINE test message error:',
        error
      );

      return res.status(500).json({
        error:
          'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบการตั้งค่า LINE'
      });
    }
  }
);

/* =====================================================
   TEST MESSAGE ALIAS
   รองรับ Frontend ที่เรียก /test-message
===================================================== */

router.post(
  '/test-message',
  async (req, res) => {

    const user =
      getStudentFromRequest(req);

    if (!user) {
      return res.status(403).json({
        error: 'ไม่มีสิทธิ์'
      });
    }

    const connection =
      getConnectedParent(user.id);

    if (!connection) {
      return res.status(400).json({
        error:
          'ยังไม่ได้เชื่อมต่อ LINE ผู้ปกครอง'
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

      return res.json({
        ok: true,
        message:
          'ส่งข้อความทดสอบสำเร็จ'
      });

    } catch (error) {

      console.error(
        'LINE test-message error:',
        error
      );

      return res.status(500).json({
        error:
          'ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบการตั้งค่า LINE'
      });
    }
  }
);

/* =====================================================
   SMART ALERT
===================================================== */

async function sendSmartAlert(studentId) {

  const db = store.read();

  const connection =
    db.parentConnections.find(
      item =>
        item.studentId === studentId &&
        item.status === 'CONNECTED'
    );

  if (!connection) {
    throw new Error(
      'No connected parent'
    );
  }

  const student =
    db.users.find(
      user =>
        user.id === studentId
    );

  const physics =
    db.subjects.find(
      subject =>
        subject.name === 'Physics'
    );

  const studentName =
    student?.name || 'สมชาย ใจดี';

  const score =
    physics?.score ?? 42;

  await linePush(
    connection.lineUserId,
    [
      {
        type: 'text',
        text:
          `🔴 STUDLY Smart Alert\n` +
          `แจ้งเตือนการเรียนของ${studentName}\n\n` +
          `Physics มีความเสี่ยงสูง 🔴\n` +
          `• คะแนนปัจจุบัน: ${score}%\n` +
          `• งานสำคัญใกล้ Deadline: 1 งาน\n\n` +
          `แนะนำให้ช่วยน้องวางแผนการทำงาน`
      }
    ]
  );
}

/* =====================================================
   SMART ALERT API
===================================================== */

router.post(
  '/smart-alert',
  async (req, res) => {

    const user =
      getStudentFromRequest(req);

    if (!user) {
      return res.status(403).json({
        error: 'ไม่มีสิทธิ์'
      });
    }

    try {

      await sendSmartAlert(user.id);

      return res.json({
        ok: true,
        message:
          'ส่ง Smart Alert สำเร็จ'
      });

    } catch (error) {

      console.error(
        'LINE Smart Alert error:',
        error
      );

      return res.status(500).json({
        error:
          'ไม่สามารถส่ง Smart Alert ได้ กรุณาตรวจสอบการตั้งค่า LINE'
      });
    }
  }
);

/* =====================================================
   REQUEST DISCONNECT
   นักเรียนกดปุ่มยกเลิก
   แต่ยังไม่ตัดทันที
===================================================== */

router.post(
  '/disconnect',
  async (req, res) => {

    const user =
      getStudentFromRequest(req);

    if (!user) {
      return res.status(403).json({
        error: 'ไม่มีสิทธิ์'
      });
    }

    const connection =
      getConnectedParent(user.id);

    if (!connection) {
      return res.status(400).json({
        error:
          'ยังไม่ได้เชื่อมต่อ LINE ผู้ปกครอง'
      });
    }

    try {

      await linePush(
        connection.lineUserId,
        [
          {
            type: 'template',

            altText:
              'ยืนยันการยกเลิกการเชื่อมต่อ STUDLY',

            template: {
              type: 'confirm',

              text:
                'ต้องการยกเลิกการเชื่อมต่อ STUDLY กับบัญชีนักเรียนนี้หรือไม่?',

              actions: [
                {
                  type: 'postback',
                  label:
                    'ยืนยันยกเลิก',

                  data:
                    `disconnect_confirm:${user.id}`
                },

                {
                  type: 'postback',
                  label:
                    'ยกเลิก',

                  data:
                    `disconnect_cancel:${user.id}`
                }
              ]
            }
          }
        ]
      );

      return res.json({
        ok: true,
        message:
          'ส่งคำขอยืนยันการยกเลิกไปยัง LINE ผู้ปกครองแล้ว'
      });

    } catch (error) {

      console.error(
        'LINE disconnect request error:',
        error
      );

      return res.status(500).json({
        error:
          'ไม่สามารถส่งคำขอยืนยันการยกเลิกได้'
      });
    }
  }
);

/* =====================================================
   EXPORT
===================================================== */

module.exports = {
  router
};
