const Content = require('../models/Content');
const Topic   = require('../models/Topic');
const { extractTopicsAndSummaries } = require('../config/aiService');
const pdfParse     = require('pdf-parse');
const officeParser = require('officeparser');
const path         = require('path');
const os           = require('os');
const fs           = require('fs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getFileType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac'].includes(ext))          return 'audio';
  if (ext === '.pdf')                                           return 'pdf';
  if (['.ppt', '.pptx'].includes(ext))                         return 'ppt';
  return 'text';
};

/**
 * Extract text from PPT/PPTX.
 * officeparser needs a file on disk; write buffer to OS temp dir, parse, delete.
 */
const extractPptText = (buffer, originalName) =>
  new Promise((resolve) => {
    const tmpPath = path.join(os.tmpdir(), `ppt-${Date.now()}-${originalName}`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      officeParser.parseOffice(tmpPath, (text, err) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        if (err) { console.error('PPT extraction error:', err.message); resolve(''); }
        else resolve((text || '').trim());
      });
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      console.error('PPT tmp write error:', e.message);
      resolve('');
    }
  });

const sanitiseText = (text) =>
  (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

// ─── Upload ───────────────────────────────────────────────────────────────────

// @desc  Upload content (text / PDF / PPT / video / audio)
// @route POST /api/content/upload
const uploadContent = async (req, res) => {
  const { title, textContent } = req.body;
  let rawText  = '';
  let fileType = 'text';
  let fileName = '';

  try {
    if (req.file) {
      // With multer memoryStorage, file data is in req.file.buffer (no path)
      fileName = req.file.originalname;
      fileType = getFileType(fileName);

      if (fileType === 'pdf') {
        const pdfData = await pdfParse(req.file.buffer);
        rawText = sanitiseText(pdfData.text || '');

        if (!rawText || rawText.length < 50) {
          return res.status(422).json({
            message:
              'Could not extract readable text from this PDF. ' +
              'It may be scanned or image-based. Try pasting the text directly.',
          });
        }
        console.log(`PDF extracted: ${rawText.length} chars from "${fileName}"`);

      } else if (fileType === 'ppt') {
        rawText = sanitiseText(await extractPptText(req.file.buffer, fileName));

        if (!rawText || rawText.length < 50) {
          rawText =
            `PowerPoint uploaded: "${fileName}". ` +
            'Text extraction produced insufficient content. ' +
            'Please add speaker notes or paste the slide text manually.';
          console.warn(`PPT extraction insufficient for "${fileName}"`);
        } else {
          console.log(`PPT extracted: ${rawText.length} chars from "${fileName}"`);
        }

      } else {
        // video / audio — no transcription yet
        rawText =
          `${fileType.toUpperCase()} file uploaded: "${fileName}". ` +
          'Transcription is not yet supported. Please paste a transcript manually.';
      }

    } else if (textContent && textContent.trim().length > 0) {
      rawText  = sanitiseText(textContent.trim());
      fileType = 'text';
      if (rawText.length < 30) {
        return res.status(422).json({ message: 'Text content is too short to extract topics from.' });
      }

    } else {
      return res.status(400).json({ message: 'No content provided.' });
    }

    const content = await Content.create({
      title:      (title || fileName || 'Untitled').trim(),
      uploadedBy: req.user._id,
      fileType,
      rawText,
      fileName,
      filePath:   '',   // no disk path in serverless
      status:     'uploaded',
    });

    res.status(201).json(content);

  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ message: 'Upload failed: ' + err.message });
  }
};

// ─── Process ──────────────────────────────────────────────────────────────────

// @desc  Run AI processing to extract topics from content
// @route POST /api/content/:id/process
const processContent = async (req, res) => {
  try {
    const content = await Content.findById(req.params.id);
    if (!content) return res.status(404).json({ message: 'Content not found.' });

    if (content.uploadedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorised.' });
    }

    const usableText = (content.rawText || '').trim();
    if (usableText.length < 30) {
      return res.status(422).json({
        message: 'This content does not have enough text for AI processing.',
      });
    }

    // Delete previous topics to prevent duplicates on re-process
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
        title:      t.title,
        summary:    t.summary,
        difficulty: t.difficulty || 'normal',
        contentId:  content._id,
        createdBy:  req.user._id,
        order:      i,
      }))
    );

    content.status = 'processed';
    await content.save();

    res.json({ content, topics: createdTopics });

  } catch (err) {
    console.error('Process error:', err.message);
    try { await Content.findByIdAndUpdate(req.params.id, { status: 'failed' }); } catch (_) {}

    const isQuota =
      err.message?.includes('429') ||
      err.message?.toLowerCase().includes('quota') ||
      err.message?.toLowerCase().includes('rate');

    res.status(500).json({
      message: isQuota
        ? 'AI quota limit reached. Please wait a minute and try again.'
        : 'AI processing failed: ' + err.message,
    });
  }
};

// ─── List / Topics ────────────────────────────────────────────────────────────

// @desc  Get all content by logged-in faculty
// @route GET /api/content
const getMyContent = async (req, res) => {
  try {
    const content = await Content.find({ uploadedBy: req.user._id }).sort({ createdAt: -1 });
    res.json(content);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  Get topics for a content document
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
