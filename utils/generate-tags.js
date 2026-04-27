/**
 * Generate tags from extracted_data JSONB for document tagging.
 *
 * Sources:
 *  - document_type words (e.g. "closing statement" -> ["closing", "statement"])
 *  - parties array
 *  - property_info.address keywords (split on commas/spaces, skip short tokens)
 *  - amounts > $100k -> "high-value"
 *  - file_type passed in separately
 */
function generateTags(extractedData, fileType) {
  const tags = new Set();

  if (!extractedData || extractedData.error) {
    if (fileType) tags.add(fileType.toLowerCase());
    return Array.from(tags);
  }

  // document_type words
  if (extractedData.document_type) {
    const words = extractedData.document_type.toLowerCase().split(/[\s_\-\/]+/);
    for (const w of words) {
      const trimmed = w.trim();
      if (trimmed.length > 1) tags.add(trimmed);
    }
  }

  // parties
  if (Array.isArray(extractedData.parties)) {
    for (const party of extractedData.parties) {
      if (typeof party === 'string' && party.trim().length > 1) {
        tags.add(party.trim());
      }
    }
  }

  // property_info.address keywords
  if (extractedData.property_info && extractedData.property_info.address) {
    const addr = extractedData.property_info.address;
    const parts = addr.split(/[,\s]+/);
    for (const p of parts) {
      const trimmed = p.trim().replace(/[^a-zA-Z0-9]/g, '');
      if (trimmed.length > 2) tags.add(trimmed);
    }
  }

  // amounts > 100k -> "high-value"
  if (Array.isArray(extractedData.amounts)) {
    for (const amt of extractedData.amounts) {
      let num = amt;
      if (typeof amt === 'string') {
        num = parseFloat(amt.replace(/[$,]/g, ''));
      }
      if (typeof num === 'number' && !isNaN(num) && num > 100000) {
        tags.add('high-value');
        break;
      }
    }
  }

  // file_type
  if (fileType) {
    tags.add(fileType.toLowerCase());
  }

  return Array.from(tags);
}

module.exports = { generateTags };
