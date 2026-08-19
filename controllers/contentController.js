const Content = require('../models/Content');
const Topic = require('../models/Topic');
const { extractTopicsAndSummaries } = require('../config/aiService');
const pdfParse = require('pdf-parse');
const officeParser = require('officeparser');
const fs = require('fs');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getFileType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac'].includes(ext)) return 'audio';
  if (ext === '.pdf') return 'pdf';
  if (['.ppt', '.pptx'].includes(ext)) return 'ppt';
  return 'text';
};

/**
 * Extract text from a PPTX / PPT file using officeparser.
 * Returns empty string on failure so the caller can decide what to do.
 */
const extractPptText = (filePath) =>
  new Promise((resolve) => {
    officeParser.parseOffice(filePath, (text, err) => {
      if (err) {
        console.error('PPT extraction error:', err.message);
        resolve('');
      } else {
        resolve((text || '').trim());
      }
    });
  });

/**
 * Basic cleanup for extracted text — removes garbage characters and normalises
 * whitespace. Keeps it light because aiService.prepareText() does a deeper
 * clean before the API call.
 */
const sanitiseText = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

// ─── Controllers ──────────────────────────────────────────────────────────────

// @desc  Upload content (text / PDF / PPT / video / audio)
// @route POST /api/content/upload
const uploadContent = async (req, res) => {
  const { title, textContent } = req.body;
  let rawText = '';
  let fileType = 'text';
  let fileName = '';
  let filePath = '';

  try {
    if (req.file) {
      fileName = req.file.originalname;
      filePath = req.file.path;
      fileType = getFileType(fileName);

      if (fileType === 'pdf') {
        // ── PDF ──────────────────────────────────────────────────────────────
        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdfParse(dataBuffer);
        rawText = sanitiseText(pdfData.text || '');

        if (!rawText || rawText.length < 50) {
          fs.unlinkSync(req.file.path);
          return res.status(422).json({
            message:
              'Could not extract readable text from this PDF. ' +
              'It may be scanned or image-based. Try pasting the text directly.',
          });
        }

        console.log(`PDF extracted: ${rawText.length} chars from "${fileName}"`);
        fs.unlinkSync(req.file.path);
        filePath = '';

      } else if (fileType === 'ppt') {
        // ── PPT / PPTX ───────────────────────────────────────────────────────
        rawText = sanitiseText(await extractPptText(req.file.path));

        if (!rawText || rawText.length < 50) {
          // Extraction failed or slides had only images — keep file, warn user
          rawText =
            `PowerPoint file uploaded: "${fileName}". ` +
            'Automatic text extraction produced insufficient content. ' +
            'Please add speaker notes or paste the slide text manually.';
          console.warn(`PPT extraction insufficient for "${fileName}"`);
        } else {
          console.log(`PPT extracted: ${rawText.length} chars from "${fileName}"`);
        }

        fs.unlinkSync(req.file.path);
        filePath = '';

      } else if (fileType === 'video' || fileType === 'audio') {
        // ── Media — keep file, transcription is a future feature ─────────────
        rawText =
          `${fileType.toUpperCase()} file uploaded: "${fileName}". ` +
          'Transcription support is not yet available. ' +
          'Please paste a transcript or notes manually.';
      }

    } else if (textContent && textContent.trim().length > 0) {
      rawText = sanitiseText(textContent.trim());
      fileType = 'text';

      if (rawText.length < 30) {
        return res.status(422).json({ message: 'Text content is too short to extract topics from.' });
      }
    } else {
      return res.status(400).json({ message: 'No content provided.' });
    }

    const content = await Content.create({
      title: (title || fileName || 'Untitled').trim(),
      uploadedBy: req.user._id,
      fileType,
      rawText,
      fileName,
      filePath,
      status: 'uploaded',
    });

    res.status(201).json(content);

  } catch (err) {
    // Clean up temp file if still on disk
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('Upload error:', err.message);
    res.status(500).json({ message: 'Upload failed: ' + err.message });
  }
};

// @desc  Run AI processing to extract topics from content
// @route POST /api/content/:id/process
const processContent = async (req, res) => {
  try {
    const content = await Content.findById(req.params.id);
    if (!content) return res.status(404).json({ message: 'Content not found.' });

    if (content.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorised.' });
    }

    // Guard: make sure there is extractable text
    const usableText = (content.rawText || '').trim();
    if (usableText.length < 30) {
      return res.status(422).json({
        message:
          'This content does not have enough text for AI processing. ' +
          'Edit the content and add more text first.',
      });
    }

    // Prevent duplicates: delete any previously generated topics for this content
    await Topic.deleteMany({ contentId: content._id });

    content.status = 'processing';
    await content.save();

    const topics = await extractTopicsAndSummaries(usableText, req.user._id);

    if (!topics || topics.length === 0) {
      content.status = 'failed';
      await content.save();
      return res.status(500).json({ message: 'AI returned no topics. Please try again.' });
    }

    const createdTopics = await Topic.insertMany(
      topics.map((t, i) => ({
        title: t.title,
        summary: t.summary,
        difficulty: t.difficulty || 'normal',
        contentId: content._id,
        createdBy: req.user._id,
        order: i,
      }))
    );

    content.status = 'processed';
    await content.save();

    res.json({ content, topics: createdTopics });

  } catch (error) {
    console.error('Process error:', error.message);

    // Mark as failed so the UI can show a meaningful state
    try {
      await Content.findByIdAndUpdate(req.params.id, { status: 'failed' });
    } catch (_) {}

    // Surface rate-limit errors clearly to the frontend
    const isQuota =
      error.message?.includes('429') ||
      error.message?.toLowerCase().includes('quota') ||
      error.message?.toLowerCase().includes('rate');

    const message = isQuota
      ? 'AI quota limit reached. Please wait a minute and try again.'
      : 'AI processing failed: ' + error.message;

    res.status(500).json({ message });
  }
};

// @desc  Get all content uploaded by the logged-in faculty member
// @route GET /api/content
const getMyContent = async (req, res) => {
  try {
    const content = await Content.find({ uploadedBy: req.user._id }).sort({ createdAt: -1 });
    res.json(content);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Get all topics belonging to a content document
// @route GET /api/content/:id/topics
const getContentTopics = async (req, res) => {
  try {
    const topics = await Topic.find({ contentId: req.params.id }).sort({ order: 1 });
    res.json(topics);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { uploadContent, processContent, getMyContent, getContentTopics };
