const fs = require('fs');

function escapeRegex(string) { 
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

const templates = JSON.parse(fs.readFileSync('templates.json', 'utf8'));

['src/workflow/BundledTemplates.js', 'src/workflow/BundledWorkflowsExtra.js'].forEach(file => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  for (let t of templates) {
    let searchPattern = new RegExp('("id":\\s*' + t.id + ',\\s*"name":\\s*"' + escapeRegex(t.name) + '",[\\s\\S]*?(?:(?="video_url")|(?="category_id")|(?="nodes")))', 'g');
    content = content.replace(searchPattern, (match, p1) => {
       if (match.includes('"thumbnail_url"')) {
           return match.replace(/"thumbnail_url":\s*("[^"]*"|null)/, '"thumbnail_url": "../../assets/templates/thumb_' + t.id + '.png"');
       } else {
           return p1 + '"thumbnail_url": "../../assets/templates/thumb_' + t.id + '.png",\n    ';
       }
    });
  }
  fs.writeFileSync(file, content);
});

console.log('Done!');
