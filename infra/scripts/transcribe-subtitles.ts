#!/usr/bin/env node
/**
 * Generates subtitles for /content titles that don't have them yet, using
 * Amazon Transcribe (StartTranscriptionJob with Subtitles: { Formats: ['srt'] }).
 *
 * This is a manual, one-off helper — not part of the CDK stack or the API's
 * request path — for the AWS Builder mini challenge's Transcribe integration.
 *
 * Usage:
 *   npx tsx infra/scripts/transcribe-subtitles.ts --bucket my-scratch-bucket [--wait] [--region us-east-1]
 *
 * What it does, per title in /content/titles.json missing a "subtitles" field
 * (or whose subtitles file doesn't exist locally):
 *   1. Uploads the local video (content/video/<id>.<ext>, matched by filename
 *      stem) to s3://<bucket>/contextcue-transcribe-input/<id>/<filename> if
 *      it isn't already an s3:// URL.
 *   2. Starts a Transcribe job requesting SRT subtitles, written to
 *      s3://<bucket>/contextcue-transcribe-output/<id>/.
 *   3. With --wait: polls until the job completes, downloads the resulting
 *      .srt to content/subtitles/<id>.srt, and patches titles.json's
 *      "subtitles" field to point at it.
 *
 * Without --wait, the script just starts the jobs and prints their names —
 * transcription of a feature-length video can take several minutes. Re-run
 * with --wait (or check the AWS console / `aws transcribe get-transcription-job`)
 * once jobs are done.
 *
 * Requires AWS credentials with transcribe:StartTranscriptionJob /
 * GetTranscriptionJob and s3:PutObject/GetObject on the given bucket.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  type TranscriptionJobStatus
} from '@aws-sdk/client-transcribe';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

interface TitleMeta {
  id: string;
  title: string;
  durationMs: number;
  videoUrl: string;
  subtitles?: string;
  license: string;
  poster?: string;
}

interface Args {
  bucket: string;
  region: string;
  wait: boolean;
  pollIntervalMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const bucket = get('--bucket');
  if (!bucket) {
    console.error('Usage: transcribe-subtitles --bucket <s3-bucket> [--wait] [--region us-east-1]');
    process.exit(1);
  }
  return {
    bucket,
    region: get('--region') ?? process.env.AWS_REGION ?? 'us-east-1',
    wait: argv.includes('--wait'),
    pollIntervalMs: Number(get('--poll-ms') ?? 15_000)
  };
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const TITLES_JSON = path.join(CONTENT_DIR, 'titles.json');
const VIDEO_DIR = path.join(CONTENT_DIR, 'video');
const SUBTITLES_DIR = path.join(CONTENT_DIR, 'subtitles');

function findLocalVideoFile(id: string): string | undefined {
  if (!existsSync(VIDEO_DIR)) return undefined;
  const match = readdirSync(VIDEO_DIR).find((f) => path.parse(f).name === id);
  return match ? path.join(VIDEO_DIR, match) : undefined;
}

function needsSubtitles(title: TitleMeta): boolean {
  if (!title.subtitles) return true;
  return !existsSync(path.join(CONTENT_DIR, title.subtitles));
}

async function uploadIfNeeded(s3: S3Client, bucket: string, id: string): Promise<string> {
  const localPath = findLocalVideoFile(id);
  if (!localPath) {
    throw new Error(
      `No local video found for title "${id}" in ${VIDEO_DIR} (expected a file named "${id}.<ext>"). ` +
        'Download it first, or pass an s3:// videoUrl directly in titles.json.'
    );
  }
  const key = `contextcue-transcribe-input/${id}/${path.basename(localPath)}`;
  console.log(`Uploading ${localPath} -> s3://${bucket}/${key} ...`);
  const body = await readFile(localPath);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  return `s3://${bucket}/${key}`;
}

async function startJob(
  transcribe: TranscribeClient,
  bucket: string,
  id: string,
  mediaUri: string
): Promise<string> {
  const jobName = `contextcue-${id}-${Date.now()}`;
  await transcribe.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: mediaUri },
      OutputBucketName: bucket,
      OutputKey: `contextcue-transcribe-output/${id}/`,
      Subtitles: { Formats: ['srt'] },
      LanguageCode: 'en-US'
    })
  );
  console.log(`Started Transcribe job "${jobName}" for "${id}" (output: s3://${bucket}/contextcue-transcribe-output/${id}/)`);
  return jobName;
}

async function waitForJob(
  transcribe: TranscribeClient,
  jobName: string,
  pollIntervalMs: number
): Promise<TranscriptionJobStatus> {
  for (;;) {
    const res = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    const status = res.TranscriptionJob?.TranscriptionJobStatus;
    if (status === 'COMPLETED' || status === 'FAILED') return status;
    console.log(`  ${jobName}: ${status ?? 'UNKNOWN'} — polling again in ${pollIntervalMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function downloadSrt(s3: S3Client, bucket: string, id: string, jobName: string): Promise<string> {
  // Transcribe writes the subtitle file alongside the job output as <jobName>.srt.
  const key = `contextcue-transcribe-output/${id}/${jobName}.srt`;
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const srt = Buffer.concat(chunks).toString('utf-8');

  await mkdir(SUBTITLES_DIR, { recursive: true });
  const localRelPath = `subtitles/${id}.srt`;
  await writeFile(path.join(CONTENT_DIR, localRelPath), srt, 'utf-8');
  console.log(`Saved subtitles -> content/${localRelPath}`);
  return localRelPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const s3 = new S3Client({ region: args.region });
  const transcribe = new TranscribeClient({ region: args.region });

  const titles: TitleMeta[] = JSON.parse(await readFile(TITLES_JSON, 'utf-8'));
  const pending = titles.filter(needsSubtitles);

  if (pending.length === 0) {
    console.log('Every title already has subtitles on disk — nothing to do.');
    return;
  }

  console.log(`${pending.length} title(s) need subtitles: ${pending.map((t) => t.id).join(', ')}`);

  const jobs: { id: string; jobName: string }[] = [];
  for (const title of pending) {
    const mediaUri = title.videoUrl.startsWith('s3://')
      ? title.videoUrl
      : await uploadIfNeeded(s3, args.bucket, title.id);
    const jobName = await startJob(transcribe, args.bucket, title.id, mediaUri);
    jobs.push({ id: title.id, jobName });
  }

  if (!args.wait) {
    console.log('\nJobs started. Re-run with --wait to poll for completion and write .srt files.');
    return;
  }

  for (const { id, jobName } of jobs) {
    console.log(`Waiting for ${jobName} ...`);
    const status = await waitForJob(transcribe, jobName, args.pollIntervalMs);
    if (status !== 'COMPLETED') {
      console.error(`Job ${jobName} ended with status ${status} — skipping ${id}.`);
      continue;
    }
    const subtitlesPath = await downloadSrt(s3, args.bucket, id, jobName);
    const title = titles.find((t) => t.id === id);
    if (title) title.subtitles = subtitlesPath;
  }

  await writeFile(TITLES_JSON, JSON.stringify(titles, null, 2) + '\n', 'utf-8');
  console.log('Updated content/titles.json with new subtitles paths.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
