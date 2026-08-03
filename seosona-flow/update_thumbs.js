const fs = require('fs');
['src/workflow/BundledTemplates.js', 'src/workflow/BundledWorkflowsExtra.js'].forEach(file => {
  if (!fs.existsSync(file)) return;
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/("id":\s*(\d+),([^]*?)(?:"thumbnail_url":\s*"[^"]*"|(?="video_url"|"category_id"|"nodes")))/g, (match, p1, id) => {
    if (match.includes('"thumbnail_url"')) {
      return match.replace(/"thumbnail_url":\s*"[^"]*"/, '"thumbnail_url": "../../assets/templates/thumb_' + id + '.png"');
    } else {
      return p1 + '"thumbnail_url": "../../assets/templates/thumb_' + id + '.png",\n    ';
    }
  });
  fs.writeFileSync(file, code);
});
