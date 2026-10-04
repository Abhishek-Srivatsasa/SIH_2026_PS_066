svg = '''
<div class="region-picker reveal">
  <div class="rp-header">
    <div class="eyebrow accent">Select Basin</div>
    <h3>Region Select</h3>
  </div>
  <svg class="rp-map" viewBox="0 0 400 300">
    <defs>
      <pattern id="dotGrid" width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="var(--line-2)" />
      </pattern>
    </defs>
    <!-- Background grid -->
    <rect width="400" height="300" fill="url(#dotGrid)" rx="8"/>
    
    <!-- Arabian Sea -->
    <path class="rp-region rp-disabled" d="M0,0 L140,0 L110,80 L140,160 L180,260 L195,290 L0,290 Z" />
    <text x="70" y="150" class="rp-label">Arabian Sea</text>
    <text x="70" y="170" class="rp-sub">Coming Soon</text>
    
    <!-- Bay of Bengal -->
    <path class="rp-region rp-active" d="M195,290 L230,220 L270,160 L320,120 L350,60 L400,0 L400,290 Z" />
    <text x="320" y="150" class="rp-label">Bay of Bengal</text>
    <text x="320" y="170" class="rp-sub">Active</text>
    
    <!-- India Landmass -->
    <path class="rp-land" d="M140,0 L110,80 L140,160 L180,260 L195,290 L230,220 L270,160 L320,120 L350,60 L400,0 Z" />
    <text x="220" y="80" class="rp-land-label">INDIA</text>
  </svg>
</div>
'''

with open('site/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Insert right before the explorer toolbar
html = html.replace('<div class="toolbar reveal" id="toolbar">', svg + '\n        <div class="toolbar reveal" id="toolbar">')

with open('site/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
