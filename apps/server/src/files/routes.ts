import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { imageSize } from 'image-size';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireUser } from '../auth/sessions';
import { getMembership } from '../campaigns/membership';
import { uploads } from '../db/schema';

const Uuid = z.string().uuid();
const FileName = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
const TYPES: Record<string, { ext: string; contentType: string }> = {
  png: { ext: 'png', contentType: 'image/png' },
  jpg: { ext: 'jpg', contentType: 'image/jpeg' },
  webp: { ext: 'webp', contentType: 'image/webp' },
};

export async function registerFileRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, config, files } = deps;
  const auth = { preHandler: requireUser(db) };
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

  app.post('/api/campaigns/:id/uploads', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const member = Uuid.safeParse(id).success ? await getMembership(db, id, req.user!.id) : null;
    if (!member) return reply.code(404).send({ error: 'not_found' });
    if (member.role !== 'gm') return reply.code(403).send({ error: 'forbidden' });

    const part = await req.file();
    if (!part || part.fieldname !== 'file') return reply.code(400).send({ error: 'invalid_image' });
    let data: Buffer;
    try {
      data = await part.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'too_large' });
      }
      throw err;
    }
    if (part.file.truncated) return reply.code(413).send({ error: 'too_large' });

    let info: ReturnType<typeof imageSize>;
    try {
      info = imageSize(data);
    } catch {
      return reply.code(400).send({ error: 'invalid_image' });
    }
    const type = TYPES[info.type ?? ''];
    if (!type || !info.width || !info.height) return reply.code(400).send({ error: 'invalid_image' });

    const key = `${id}/${randomUUID()}.${type.ext}`;
    await files.put(key, data);
    await db.insert(uploads).values({
      key,
      campaignId: id,
      contentType: type.contentType,
      sizeBytes: data.length,
      width: info.width,
      height: info.height,
    });
    return reply.code(201).send({ key, width: info.width, height: info.height, url: `/files/${key}` });
  });

  app.get('/files/:campaignId/:file', auth, async (req, reply) => {
    const { campaignId, file } = req.params as { campaignId: string; file: string };
    if (!Uuid.safeParse(campaignId).success || !FileName.test(file)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const key = `${campaignId}/${file}`;
    const [row] = await db.select().from(uploads).where(eq(uploads.key, key));
    if (!row || row.campaignId !== campaignId) return reply.code(404).send({ error: 'not_found' });
    if (!(await getMembership(db, campaignId, req.user!.id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const data = await files.get(key);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return reply.header('content-type', row.contentType).header('cache-control', 'private, max-age=3600').send(data);
  });
}
