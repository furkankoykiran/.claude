---
name: linkedin-post
description: Generate LinkedIn posts from blog content, URLs, or chat context with professional formatting
---

# LinkedIn Post Generator

Generate professional LinkedIn posts from blog articles, URLs, or conversation context.

## Input

Content source provided as `$ARGUMENTS`:
- Blog post URL
- Project GitHub URL
- Or simply describe the topic from chat context

## Workflow

### Step 1: Get Content Source

Use AskUserQuestion to ask:
```
LinkedIn postu hangi kaynaktan oluşturulsun?

1. Blog URL'si (Web Reader ile oku)
2. GitHub projesi
3. Mevcut sohbet konusu
4. Manuel açıklama gir
```

### Step 2: Fetch Content

**For URL/Blog**: Use the built-in `WebFetch` tool (or any equivalent web-reading MCP you have configured) to read the article content.
**For GitHub**: Use `mcp__github__get_file_contents` to explore the project.
**For Chat**: Analyze the conversation history for key topics.

### Step 3: Analyze Content Structure

Extract the following elements:
1. **Core Problem/Challenge** - What problem was solved?
2. **Solution Approach** - How was it solved?
3. **Technical Stack** - Technologies, tools, frameworks used
4. **Key Results** - Metrics, outcomes, benefits
5. **Learning Points** - What can others learn?
6. **Links** - GitHub, Blog, NPM, Dev.to, Kaggle, etc.

### Step 4: Ask Language Preference

```
Post hangi dilde olsun?

1. Türkçe
2. İngilizce
3. Hem Türkçe hem İngilizce
```

**Default**: Option 1 (Turkish)

### Step 5: Generate LinkedIn Post

Create a post following this structure:

#### Format Template

```
[STRONG OPENING HOOK - Attention-grabbing first sentence]

[2-3 sentences introducing the core topic/project]

[Brief context or journey - how you got here]

---

[KEY DETAILS - Technical implementation, challenges solved]
- [Point 1]
- [Point 2]
- [Point 3]

[Optional: Technical deep-dive if relevant]

[Practical use case or benefit]

Full story & Architecture:
Blog: [URL]
GitHub: [URL]
[Other relevant links]

hashtag#[tag1] hashtag#[tag2] hashtag#[tag3] hashtag#[tag4] hashtag#[tag5]
```

#### Style Guidelines

**Opening Hook Examples:**
- "Open Source dünyasında ilerlemek için en iyi yöntem..."
- "In the age of AI, 'seeing' is no longer 'believing.'"
- "Duolingo'nun baykuşundan kaçmak için..."
- "Yapay zeka modellerinin asıl sorunu..."

**Structure Rules:**
- Start with a strong, bold statement
- Keep it concise (100-150 words ideally)
- Use bullet points for details
- Include practical value/benefit
- Add "Full story & Architecture" section with links
- End with 4-6 relevant hashtags
- NO emojis in technical posts (professional tone)

**Tone:**
- Professional but authentic
- Educational and practical
- First-person perspective when appropriate
- Humble about achievements

**Link Format:**
```
Full story & Architecture:
Blog: https://lnkd.in/XXXXX
GitHub: https://lnkd.in/XXXXX
Dev.to: https://lnkd.in/XXXXX
Kaggle: https://lnkd.in/XXXXX
```

**Hashtag Format:**
- Use format: `#[Tag]` not `#tag`
- 4-6 hashtags maximum
- Mix of broad and specific tags
- Examples: `hashtag#OpenSource hashtag#AI hashtag#Python hashtag#MCP`

### Step 6: Show Draft Preview

Display the post draft clearly in terminal:

```markdown
========================================
LINKEDIN POST DRAFT
========================================

[Post content]

========================================
```

### Step 7: Ask for Approval

Ask user: "Taslak onaylanıyor mu? Kopyalama panosuna eklensin mi?"

### Step 8: Copy to Clipboard (On Approval)

On approval, use:
```bash
echo "[POST CONTENT]" | pbcopy  # macOS
# or
echo "[POST CONTENT]" | xclip -selection clipboard  # Linux
```

Confirm: "Post kopyalama panosuna kopyalandı. LinkedIn'e yapıştırabilirsiniz."

## Content Analysis Guidelines

When reading blog posts or project content, extract:

### For Technical Projects:
- What problem does it solve?
- What technologies are used?
- What was the implementation approach?
- What makes it unique?
- What can others learn from it?

### For Open Source Contributions:
- What repository/organization?
- What issue or feature?
- What was your specific contribution?
- What impact did it have?
- Link to the PR/Issue

### For Personal Journey Posts:
- What was the starting point?
- What challenges did you face?
- What did you learn?
- What's the key takeaway for others?
- What's next?

## Post Templates

### Template 1: Open Source Contribution
```
[Technology/Domain] dünyasında [problem] için en iyi yöntem - [çözüm özeti].

Son zamanlarda izlediğim yolculuğu paylaşmak istiyorum:

[Repository/Organization] projesinde [problemi] fark ettim. [Çözümü] geliştirdim.

Bu deneyim beni [diğer projelere] yönlendirdi.

Her projede farklı bir aspect deneyimledim - [teknik detaylar]. Basit bug fix'lerden başlayıp [karmaşık çözümlere] evrildi.

Open Source katkılarının gerçek değeri de bu - [öğrenilen dersler].

Detaylı Bilgi:
1- [Link 1]
2- [Link 2]
3- [Link 3]

hashtag#OpenSource hashtag#[Language] hashtag#[Domain]
```

### Template 2: Project Launch
```
[Domain/Problem] artık [çözüm/state].

[Proje Adı] adını verdiğim açık kaynaklı projeyi yayınladım.

[Problemi] çözmek için [teknolojiler] kullandım.

[Teknik detaylar ve mimari].

Projenin tüm detaylarını blog yazımda derledim.

GitHub: [Link]
Blog: [Link]
[NPM/Other]: [Link]

hashtag#OpenSource hashtag#[Tech1] hashtag#[Tech2] hashtag#[Domain]
```

### Template 3: Learning Journey
```
[Teknoloji/Konuya] giriş serüvenim.

[Problemi] çözmek istedim. [Çözüm için] [proje/adı] geliştirdim.

[Adım adım gelişim].

Öğrendiklerim:
- [Ders 1]
- [Ders 2]
- [Ders 3]

Sıradaki adımlar:
- [Plan 1]
- [Plan 2]

Proje: [Link]
Detaylar: [Link]

hashtag#Learning hashtag#[Tech] hashtag#OpenSource hashtag#SideProject
```

## Critical Requirements

- **Analyze content first** - Don't generate without understanding the source
- **Strong opening hook** - First sentence must grab attention
- **Keep it concise** - LinkedIn readers skim, be brief
- **Professional tone** - No excessive emojis
- **Include links** - Always reference source material
- **Practical value** - What can the reader learn or use?
- **Hashtag format** - Use `hashtag#[Tag]` format
- **Show draft first** - Never auto-post
- **User approval** - Always get confirmation before copying

## URL Shortener

When adding links, prefer LinkedIn's native shortener:
- Use `https://lnkd.in/XXXXX` format if available
- Or use the tool's shortener feature
- Long URLs are fine if shortener unavailable

## Hashtag Strategy

### Primary Tags (Broad)
- `hashtag#OpenSource`
- `hashtag#AI`
- `hashtag#Python`
- `hashtag#TypeScript`
- `hashtag#Security`

### Secondary Tags (Specific)
- `hashtag#MCP`
- `hashtag#DeepLearning`
- `hashtag#ComputerVision`
- `hashtag#Automation`
- `hashtag#SideProject`

### Technology Tags
- `hashtag#React`
- `hashtag#Nodejs`
- `hashtag#SystemDesign`
- `hashtag#Backend`
- `hashtag#CyberSecurity`

Choose 4-6 relevant tags maximum.