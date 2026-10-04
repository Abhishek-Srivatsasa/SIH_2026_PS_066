import re

with open('site/style.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Let's keep background meshes or vignettes, but remove them from buttons, text, icons, progress bars, etc.
# Text gradients
css = re.sub(r'linear-gradient\([^)]+var\(--cyan\),var\(--teal\)[^)]*\)', 'var(--cyan)', css)
css = re.sub(r'linear-gradient\([^)]+var\(--indigo\),var\(--cyan\)[^)]*\)', 'var(--cyan)', css)
css = re.sub(r'linear-gradient\([^)]+var\(--indigo\),var\(--cyan\),var\(--teal\)[^)]*\)', 'var(--cyan)', css)
css = re.sub(r'linear-gradient\([^)]+var\(--rose\),var\(--amber\)[^)]*\)', 'var(--rose)', css)

# Background shapes (bg-au)
css = re.sub(r'radial-gradient\(circle,#0ea5e9,transparent 68%\)', 'rgba(14, 165, 233, 0.15)', css)
css = re.sub(r'radial-gradient\(circle,#7c3aed,transparent 68%\)', 'rgba(124, 58, 237, 0.15)', css)
css = re.sub(r'radial-gradient\(circle,#14b8a6,transparent 68%\)', 'rgba(20, 184, 166, 0.15)', css)
css = re.sub(r'radial-gradient\(ellipse at center,rgba\(34,211,238,\.20\),transparent 62%\)', 'rgba(34,211,238,.05)', css)

# We can just write it back
with open('site/style.css', 'w', encoding='utf-8') as f:
    f.write(css)

print('Done')
