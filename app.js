;(() => {
  const $ = sel => document.querySelector(sel)
  const $$ = sel => Array.from(document.querySelectorAll(sel))
  const nowISO = () => new Date().toISOString()
  const clamp = (n,min,max)=>Math.max(min,Math.min(max,n))
  const fmtTime = d => new Date(d).toLocaleTimeString()

  class Store {
    static KEY = 'novelcraft_v4'
    static load() {
      try {
        const raw = localStorage.getItem(Store.KEY)
        if (raw) return JSON.parse(raw)
      } catch(e){ console.warn('load error', e) }
      return { books:[], activeBookId:null }
    }
    static save(data){ localStorage.setItem(Store.KEY, JSON.stringify(data)) }
    static download(filename, content, type='text/plain'){
      const blob = new Blob([content], {type}); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    }
  }

  class NovelCraft {
    constructor(){
      this.library = Store.load()
      if (this.library.books.length === 0) this.createBook({title:'My First Book', goal:50000})
      this.book = this.getActiveBook() || this.library.books[0]
      this.library.activeBookId = this.book.id
      if (!this.book.chapters?.length) this.addChapter('Chapter 1')
      this.currentChapterId = this.book.chapters[0].id

      // Modes
      this.focusMode = false
      this.typewriter = false
      this.sound = new window.TypewriterSound()
      
      // Panel tracking
      this.currentPanel = null

      this.mount()
      this.renderAll()
      this.autosave()
      this.ticker()
      
      // Handle PWA shortcuts
      this.handlePWAShortcuts()
    }

    // Handle PWA shortcut actions
    handlePWAShortcuts() {
      const params = new URLSearchParams(window.location.search)
      const action = params.get('action')
      
      if (action === 'new-book') {
        setTimeout(() => this.openBookModal(), 500)
      } else if (action === 'library') {
        setTimeout(() => this.openLibrary(), 500)
      }
    }

    // Library
    createBook({title='Untitled Book', author='', genre='', logline='', goal=50000, theme='light', cover='#5b7cfa'}={}){
      const book = {
        id: 'book-'+Date.now()+Math.random().toString(36).slice(2,6),
        title, author, genre, logline, goal, theme, cover,
        createdAt: nowISO(), updatedAt: nowISO(),
        chapters: [], characters: [], notes: [],
        planner: { snowflake:{}, plot:{}, magic:{}, world:{} },
        snapshots:[]
      }
      this.library.books.unshift(book)
      this.library.activeBookId = book.id
      Store.save(this.library)
      return book
    }
    getActiveBook(){ return this.library.books.find(b => b.id === this.library.activeBookId) || null }
    setActiveBook(id){
      const b = this.library.books.find(x=>x.id===id); if (!b) return
      this.library.activeBookId = id; this.book = b; this.currentChapterId = b.chapters[0]?.id || null
      document.body.setAttribute('data-theme', b.theme || 'light')
      $('#themeSelect').value = b.theme || 'light'
      Store.save(this.library)
      this.renderAll()
      this.closeModal('#libraryModal')
    }
    updateBookMeta(patch){
      Object.assign(this.book, patch, {updatedAt: nowISO()})
      Store.save(this.library)
      this.renderBookMeta()
    }
    deleteBook(id){
      if (!confirm('Delete this book permanently?')) return
      this.library.books = this.library.books.filter(b=>b.id!==id)
      if (!this.library.books.length){ const b = this.createBook({title:'New Book'}); this.book = b }
      this.library.activeBookId = this.library.books[0].id
      this.book = this.getActiveBook()
      Store.save(this.library)
      this.renderAll()
      this.renderLibrary()
    }
    duplicateBook(id){
      const src = this.library.books.find(b=>b.id===id); if (!src) return
      const copy = JSON.parse(JSON.stringify(src))
      copy.id = 'book-'+Date.now()+Math.random().toString(36).slice(2,6)
      copy.title = src.title + ' (Copy)'
      copy.createdAt = nowISO(); copy.updatedAt = nowISO()
      this.library.books.unshift(copy)
      Store.save(this.library)
      this.renderLibrary()
    }

    // Chapters
    addChapter(title='New Chapter'){
      const ch = { id:'ch-'+Date.now()+Math.random().toString(36).slice(2,5), title, content:'', wordCount:0, createdAt:nowISO(), updatedAt:nowISO() }
      this.book.chapters.push(ch)
      this.currentChapterId = ch.id
      this.save()
      this.renderChapters()
      this.loadChapter(ch.id)
    }
    deleteChapter(id){
      if (this.book.chapters.length<=1){ 
        this.showNotification('At least one chapter is required.', 'warning')
        return 
      }
      if (!confirm('Delete this chapter?')) return
      this.book.chapters = this.book.chapters.filter(c=>c.id!==id)
      this.currentChapterId = this.book.chapters[0]?.id || null
      this.save(); this.renderChapters(); if (this.currentChapterId) this.loadChapter(this.currentChapterId)
    }
    reorderChapters(fromIdx,toIdx){
      const arr = this.book.chapters
      const [moved] = arr.splice(fromIdx,1)
      arr.splice(toIdx,0,moved)
      this.save(); this.renderChapters()
    }
    currentChapter(){ return this.book.chapters.find(c=>c.id===this.currentChapterId) }

    // Characters & Notes
    addCharacter(name, description){ this.book.characters.push({id:'char-'+Date.now(), name, description, createdAt:nowISO()}); this.save() }
    addNote(title, content){ this.book.notes.push({id:'note-'+Date.now(), title, content, createdAt:nowISO()}); this.save() }

    // Snapshots
    takeSnapshot(){
      const snap = {
        id:'snap-'+Date.now(),
        timestamp: nowISO(),
        bookTitle: this.book.title,
        data: JSON.parse(JSON.stringify({
          chapters: this.book.chapters,
          characters: this.book.characters,
          notes: this.book.notes,
          planner: this.book.planner
        }))
      }
      this.book.snapshots = [snap, ...(this.book.snapshots||[])].slice(0,50)
      this.save()
      this.renderSnapshots()
      this.showNotification('Snapshot captured successfully!', 'success')
    }
    restoreSnapshot(id){
      const s = (this.book.snapshots||[]).find(x=>x.id===id); if (!s) return
      if (!confirm('Restore snapshot? This will overwrite current content.')) return
      this.book.chapters = JSON.parse(JSON.stringify(s.data.chapters))
      this.book.characters = JSON.parse(JSON.stringify(s.data.characters))
      this.book.notes = JSON.parse(JSON.stringify(s.data.notes))
      this.book.planner = JSON.parse(JSON.stringify(s.data.planner))
      this.currentChapterId = this.book.chapters[0]?.id || null
      this.save(); this.renderAll()
    }

    // Mount / Events
    mount(){
      // Nav
      $('#libraryBtn').addEventListener('click', ()=> this.openLibrary())
      $('#toggleSidebarBtn').addEventListener('click', ()=> this.toggleSidebar())
      $('#plannerBtn').addEventListener('click', ()=> this.openPlanner())
      $('#outlineBtn').addEventListener('click', ()=> this.openOutline())

      // Actions
      $('#saveBtn').addEventListener('click', ()=> this.save(true))
      $('#exportBtn').addEventListener('click', ()=> this.openExport())
      $('#backupBtn').addEventListener('click', ()=> this.openBackup())

      // Formatting
      $('#boldBtn').addEventListener('click', ()=> this.exec('bold'))
      $('#italicBtn').addEventListener('click', ()=> this.exec('italic'))
      $('#underlineBtn').addEventListener('click', ()=> this.exec('underline'))
      $('#h1Btn').addEventListener('click', ()=> document.execCommand('formatBlock', false, 'h1'))
      $('#h2Btn').addEventListener('click', ()=> document.execCommand('formatBlock', false, 'h2'))
      $('#h3Btn').addEventListener('click', ()=> document.execCommand('formatBlock', false, 'h3'))
      $('#findBtn').addEventListener('click', ()=> this.openFind())

      // Modes
      $('#themeSelect').addEventListener('change', e=>{
        document.body.setAttribute('data-theme', e.target.value)
        this.updateBookMeta({theme:e.target.value})
      })
      $('#focusBtn').addEventListener('click', ()=> this.toggleFocus())
      $('#fullscreenBtn').addEventListener('click', ()=> this.toggleFullscreen())
      $('#typewriterBtn').addEventListener('click', ()=> this.toggleTypewriter())

      // Panels
      $('#charactersBtn').addEventListener('click', ()=> this.togglePanel('characters'))
      $('#notesBtn').addEventListener('click', ()=> this.togglePanel('notes'))
      $('#outlineBtn').addEventListener('click', ()=> this.togglePanel('outline'))
      $('#closeRightPanel').addEventListener('click', ()=> this.closeRightPanel())
      $('#soundToggle').addEventListener('change', (e)=> this.sound.setEnabled(e.target.checked))

      // Sidebar
      $('#addChapterBtn').addEventListener('click', ()=> this.promptNewChapter())

      // Editor
      const ed = $('#editor')
      ed.addEventListener('input', (e)=> this.onEditorInput(e))
      ed.addEventListener('keydown', (e)=> this.onEditorKeydown(e))
      $('#chapterTitleInput').addEventListener('input', ()=> this.onTitleInput())
      $('#chapterGoalBtn').addEventListener('click', ()=> this.setChapterGoal())

      // Library modal
      $('#newBookBtn').addEventListener('click', ()=> this.openBookModal())
      $('#closeLibraryBtn').addEventListener('click', ()=> this.closeModal('#libraryModal'))

      // Book modal
      $('#closeBookModal').addEventListener('click', ()=> this.closeModal('#bookModal'))
      $('#cancelBookBtn').addEventListener('click', ()=> this.closeModal('#bookModal'))
      $('#saveBookBtn').addEventListener('click', ()=> this.saveBookFromModal())

      // Planner modal
      $('#closePlannerBtn').addEventListener('click', ()=> this.closeModal('#plannerModal'))

      // Find modal
      $('#closeFindModal').addEventListener('click', ()=> this.closeModal('#findModal'))
      $('#findNextBtn').addEventListener('click', ()=> this.findNext())
      $('#replaceBtn').addEventListener('click', ()=> this.replaceOne())
      $('#replaceAllBtn').addEventListener('click', ()=> this.replaceAll())

      // Backup modal
      $('#closeBackupModal').addEventListener('click', ()=> this.closeModal('#backupModal'))
      $('#exportJSONBtn').addEventListener('click', ()=> this.exportLibraryJSON())
      $('#importJSONBtn').addEventListener('click', ()=> this.importLibraryJSON())
      $('#snapshotBtn').addEventListener('click', ()=> this.takeSnapshot())

      // Keyboard
      document.addEventListener('keydown', e=>{
        const meta = e.ctrlKey || e.metaKey
        const openModal = document.querySelector('.modal.show')
        
        // Close modal with Escape
        if (e.key === 'Escape') {
          if (openModal) {
            e.preventDefault()
            this.closeModal('#' + openModal.id)
            return
          }
        }
        
        // Find & Replace shortcuts
        if (openModal && openModal.id === 'findModal') {
          if (e.key === 'Enter' && e.target.id === 'findText') {
            e.preventDefault()
            this.findNext()
            return
          }
          if (e.key === 'Enter' && e.target.id === 'replaceText' && e.shiftKey) {
            e.preventDefault()
            this.replaceAll()
            return
          }
          if (e.key === 'Enter' && e.target.id === 'replaceText') {
            e.preventDefault()
            this.replaceOne()
            return
          }
        }
        
        // Global shortcuts
        if (meta && e.key.toLowerCase()==='s'){ e.preventDefault(); this.save(true) }
        if (meta && e.key.toLowerCase()==='b'){ e.preventDefault(); this.exec('bold') }
        if (meta && e.key.toLowerCase()==='i'){ e.preventDefault(); this.exec('italic') }
        if (meta && e.key.toLowerCase()==='u'){ e.preventDefault(); this.exec('underline') }
        if (meta && e.key.toLowerCase()==='m'){ e.preventDefault(); this.openLibrary() }
        if (meta && e.key === '\\'){ e.preventDefault(); this.toggleSidebar() }
        if (meta && e.key.toLowerCase()==='f'){ e.preventDefault(); this.openFind() }
        if (meta && e.key.toLowerCase()==='p'){ e.preventDefault(); this.openPlanner() }
      })

      // Leave protection
      window.addEventListener('beforeunload', (e)=>{
        this.save()
        e.returnValue = ''
      })
    }

    // Rendering
    renderAll(){
      this.renderBookMeta()
      this.renderChapters()
      this.loadChapter(this.currentChapterId)
      this.renderStatus()
    }
    renderBookMeta(){
      $('#bookTitleSide').textContent = this.book.title || 'Untitled Book'
      $('#authorMeta').textContent = this.book.author || '—'
      $('#wordGoal').textContent = (this.book.goal||0).toLocaleString()
      document.body.setAttribute('data-theme', this.book.theme || 'light')
      $('#themeSelect').value = this.book.theme || 'light'
      this.updateTotals()
    }
    renderChapters(){
      const list = $('#chaptersList'); list.innerHTML = ''
      this.book.chapters.forEach((c, idx)=>{
        const el = document.createElement('div')
        el.className = 'chapter' + (c.id===this.currentChapterId ? ' active':'')

        el.draggable = true
        el.addEventListener('dragstart', ev=>{ ev.dataTransfer.setData('text/plain', idx) })
        el.addEventListener('dragover', ev=> ev.preventDefault())
        el.addEventListener('drop', ev=>{
          ev.preventDefault()
          const from = +ev.dataTransfer.getData('text/plain')
          const to = idx
          if (from!==to) this.reorderChapters(from,to)
        })

        el.innerHTML = `
          <span class="drag" title="Drag to reorder">⋮⋮</span>
          <span class="name">${c.title || 'Untitled'}</span>
          <span class="stats">${c.wordCount||0}w</span>
        `
        el.addEventListener('click', ()=> this.loadChapter(c.id))
        el.addEventListener('contextmenu', (e)=>{
          e.preventDefault()
          this.contextChapter(e, c)
        })
        list.appendChild(el)
      })
    }
    loadChapter(id){
      const ch = this.book.chapters.find(c=>c.id===id) || this.book.chapters[0]
      if (!ch) return
      this.currentChapterId = ch.id
      $('#chapterTitleInput').value = ch.title || ''
      $('#editor').innerHTML = ch.content || ''
      this.renderChapters()
      this.renderChapterStats()
      this.renderStatus()
      if (this.typewriter) setTimeout(()=> this.scrollCaretIntoView(), 30)
    }
    updateTotals(){
      const totalWords = (this.book.chapters||[]).reduce((s,c)=> s + (c.wordCount||0), 0)
      $('#totalWords').textContent = totalWords.toLocaleString()
      const goal = this.book.goal || 0
      const pct = goal ? clamp((totalWords/goal)*100,0,100) : 0
      $('#goalFill').style.width = pct+'%'
    }
    updateChapterStatsDisplay(){
      const ch = this.currentChapter(); if (!ch) return
      const chars = this.stripHTML(ch.content||'').length
      $('#chapterStatsPill').textContent = `Words: ${ch.wordCount||0} · Characters: ${chars}`
    }
    renderStatus(){
      $('#statusBook').textContent = `Book: ${this.book.title}`
      const ch = this.currentChapter()
      $('#statusChapter').textContent = ch ? `Chapter: ${ch.title}` : 'No chapter'
      $('#statusSaved').textContent = `Updated: ${fmtTime(this.book.updatedAt)}`
      $('#statusTime').textContent = new Date().toLocaleTimeString()
    }

    // Context menu
    contextChapter(e, ch){
      const menu = document.createElement('div')
      Object.assign(menu.style, {
        position:'fixed', left: e.clientX+'px', top: e.clientY+'px', background:'var(--bg-2)',
        border:'1px solid var(--line)', borderRadius:'10px', boxShadow:'var(--shadow)', zIndex:2050, minWidth:'160px'
      })
      ;[
        {t:'Rename', fn: ()=>{
          const name = prompt('Chapter title', ch.title || '')
          if (name!=null){ ch.title = name; ch.updatedAt = nowISO(); this.save(); this.renderChapters(); this.loadChapter(ch.id) }
        }},
        {t:'Duplicate', fn: ()=>{
          const copy = JSON.parse(JSON.stringify(ch))
          copy.id = 'ch-'+Date.now()
          copy.title = ch.title+' (Copy)'
          this.book.chapters.splice(this.book.chapters.indexOf(ch)+1, 0, copy)
          this.save(); this.renderChapters()
        }},
        {t:'Delete', fn: ()=> this.deleteChapter(ch.id)}
      ].forEach((row,i)=>{
        const item = document.createElement('div')
        item.textContent = row.t
        Object.assign(item.style, {padding:'10px 14px', cursor:'pointer', borderBottom: i<2 ? '1px solid var(--line)':'', userSelect:'none'})
        item.addEventListener('click', ()=> { row.fn(); cleanup() })
        menu.appendChild(item)
      })
      document.body.appendChild(menu)
      const cleanup = ()=> { if (menu.parentNode) menu.parentNode.removeChild(menu); document.removeEventListener('click', cleanup) }
      setTimeout(()=> document.addEventListener('click', cleanup), 0)
    }

    // Editor events
    onEditorInput(){
      const ch = this.currentChapter(); if (!ch) return
      ch.content = $('#editor').innerHTML
      ch.wordCount = this.countWords(ch.content)
      ch.updatedAt = nowISO()
      this.book.updatedAt = nowISO()
      this.renderChapterStats()
      this.updateTotals()
      if (this.typewriter) this.scrollCaretIntoView()
    }
    onEditorKeydown(e){
      if (this.typewriter){
        const printable = (e.key && e.key.length === 1) || ['Enter','Backspace','Tab','Delete',' '].includes(e.key)
        if (printable) this.sound.click()
        if (e.key === 'Enter') {
          // pleasant bell occasionally on paragraph end
          this.sound.bell()
        }
        setTimeout(()=> this.scrollCaretIntoView(), 0)
      }
    }
    onTitleInput(){
      const ch = this.currentChapter(); if (!ch) return
      ch.title = $('#chapterTitleInput').value
      ch.updatedAt = nowISO(); this.book.updatedAt = nowISO()
      this.renderChapters(); this.renderStatus()
    }

    setChapterGoal(){
      const ch = this.currentChapter(); if (!ch) return
      const currentGoal = ch.wordGoal || 0
      const goal = prompt(`Set word goal for "${ch.title}":`, currentGoal)
      if (goal === null) return
      const goalNum = parseInt(goal, 10)
      if (isNaN(goalNum) || goalNum < 0) {
        this.showNotification('Please enter a valid number', 'warning')
        return
      }
      ch.wordGoal = goalNum
      ch.updatedAt = nowISO(); this.book.updatedAt = nowISO()
      this.save()
      this.renderChapterStats()
      this.showNotification(`Chapter goal set to ${goalNum} words`, 'success')
    }

    renderChapterStats(){
      const ch = this.currentChapter()
      if (!ch) return
      
      const content = $('#editor').innerHTML
      const words = this.countWords(content)
      const chars = this.stripHTML(content).length
      
      $('#chapterStatsPill').textContent = `Words: ${words} · Characters: ${chars}`
      
      const goalPill = $('#chapterGoalPill')
      if (ch.wordGoal && ch.wordGoal > 0) {
        const progress = Math.round((words / ch.wordGoal) * 100)
        goalPill.textContent = `Goal: ${words}/${ch.wordGoal} (${progress}%)`
        goalPill.style.display = 'inline-flex'
        goalPill.style.color = words >= ch.wordGoal ? 'var(--success)' : 'var(--muted)'
      } else {
        goalPill.style.display = 'none'
      }
    }

    // Formatting utils
    exec(cmd){
      document.execCommand(cmd, false, null)
      $('#editor').focus()
    }
    stripHTML(html){ return (html||'').replace(/<[^>]+>/g,'') }
    countWords(html){
      const s = this.stripHTML(html).trim()
      return s ? s.split(/\s+/).length : 0
    }

    // Sidebar & Modes
    toggleSidebar(){
      const s = $('#sidebar')
      const isCollapsed = s.classList.toggle('collapsed')
      if (!isCollapsed && window.innerWidth <= 1100){
        s.classList.add('backdrop')
        const closeOnBackdrop = ev=>{
          if (!s.contains(ev.target)){ s.classList.add('collapsed'); s.classList.remove('backdrop'); document.removeEventListener('click', closeOnBackdrop) }
        }
        setTimeout(()=> document.addEventListener('click', closeOnBackdrop), 0)
      } else {
        s.classList.remove('backdrop')
      }
    }
    toggleFocus(){
      this.focusMode = !this.focusMode
      document.body.classList.toggle('focus', this.focusMode)
      $('#focusBtn').classList.toggle('primary', this.focusMode)
    }
    toggleTypewriter(){
      this.typewriter = !this.typewriter
      document.body.classList.toggle('typewriter', this.typewriter)
      $('#typewriterBtn').classList.toggle('primary', this.typewriter)
      $('#soundToggleRow').style.display = this.typewriter ? 'flex' : 'none'
      if (this.typewriter) this.scrollCaretIntoView()
    }
    toggleFullscreen(){
      if (!document.fullscreenElement){ document.documentElement.requestFullscreen?.() }
      else { document.exitFullscreen?.() }
    }
    scrollCaretIntoView(){
      const sel = window.getSelection()
      if (!sel.rangeCount) return
      const r = sel.getRangeAt(0)
      const rect = r.getBoundingClientRect()
      if (!rect || !rect.top) return
      const container = $('#edBody')
      const cRect = container.getBoundingClientRect()
      const targetY = cRect.top + cRect.height*0.40
      const diff = rect.top - targetY
      if (Math.abs(diff) > 6) container.scrollBy({top: diff, behavior:'smooth'})
    }

    // Panel toggling system
    togglePanel(panelType) {
      if (this.currentPanel === panelType) {
        // Close panel if clicking the same button
        this.closeRightPanel()
        this.currentPanel = null
        this.updatePanelButtons()
      } else {
        // Open different panel
        this.currentPanel = panelType
        if (panelType === 'characters') this.openCharacters()
        else if (panelType === 'notes') this.openNotes()
        else if (panelType === 'outline') this.openOutline()
        this.updatePanelButtons()
      }
    }

    updatePanelButtons() {
      // Reset all panel buttons
      $('#charactersBtn').classList.remove('primary')
      $('#notesBtn').classList.remove('primary')
      $('#outlineBtn').classList.remove('primary')
      
      // Highlight active panel button
      if (this.currentPanel === 'characters') $('#charactersBtn').classList.add('primary')
      else if (this.currentPanel === 'notes') $('#notesBtn').classList.add('primary')
      else if (this.currentPanel === 'outline') $('#outlineBtn').classList.add('primary')
    }

    // Right panel visibility
    openRightPanel(){
      $('#rightPanel').classList.add('active')
      $('#canvas').classList.add('with-right')
    }
    closeRightPanel(){
      $('#rightPanel').classList.remove('active')
      $('#canvas').classList.remove('with-right')
      this.currentPanel = null
      this.updatePanelButtons()
    }

    // Characters & Notes Panels
    openCharacters(){
      const body = $('#rpBody'); body.innerHTML = ''
      $('#rpTitle').textContent = 'Characters'
      $('#soundToggleRow').style.display = this.typewriter ? 'flex' : 'none'

      const form = document.createElement('div')
      form.className = 'card'
      form.innerHTML = `
        <div class="grid two" style="gap:10px">
          <div class="field full"><label>Name</label><input id="charName" type="text" placeholder="Character name"></div>
          <div class="field full"><label>Description</label><textarea id="charDesc" placeholder="Traits, goals, backstory…"></textarea></div>
          <div class="field full row end"><button class="btn primary" id="addCharBtn">Add Character</button></div>
        </div>
      `
      body.appendChild(form)
      form.querySelector('#addCharBtn').addEventListener('click', ()=>{
        const name = form.querySelector('#charName').value.trim()
        const desc = form.querySelector('#charDesc').value.trim()
        if (!name) {
          this.showNotification('Please provide a name.', 'warning')
          return
        }
        this.addCharacter(name, desc); form.querySelector('#charName').value=''; form.querySelector('#charDesc').value=''
        this.openCharacters()
      })

      ;(this.book.characters||[]).forEach(c=>{
        const card = document.createElement('div')
        card.className = 'card'
        card.innerHTML = `
          <div class="row between">
            <strong>${c.name}</strong>
            <div class="row">
              <button class="btn" data-a="edit">Edit</button>
              <button class="btn danger" data-a="del">Delete</button>
            </div>
          </div>
          <div class="muted" style="margin-top:6px;white-space:pre-wrap">${c.description||''}</div>
        `
        card.querySelector('[data-a="edit"]').addEventListener('click', ()=>{
          const name = prompt('Character name', c.name); if (name==null) return
          const desc = prompt('Description', c.description||''); if (desc==null) return
          c.name=name; c.description=desc; this.save(); this.openCharacters()
        })
        card.querySelector('[data-a="del"]').addEventListener('click', ()=>{
          if (!confirm('Delete character?')) return
          this.book.characters = this.book.characters.filter(x=>x.id!==c.id); this.save(); this.openCharacters()
        })
        body.appendChild(card)
      })
      this.openRightPanel()
    }
    openNotes(){
      const body = $('#rpBody'); body.innerHTML = ''
      $('#rpTitle').textContent = 'Notes'
      $('#soundToggleRow').style.display = this.typewriter ? 'flex' : 'none'

      const form = document.createElement('div')
      form.className = 'card'
      form.innerHTML = `
        <div class="grid two" style="gap:10px">
          <div class="field full"><label>Title</label><input id="noteTitle" type="text" placeholder="Note title"></div>
          <div class="field full"><label>Content</label><textarea id="noteContent" placeholder="Note content…"></textarea></div>
          <div class="field full row end"><button class="btn primary" id="addNoteBtn">Add Note</button></div>
        </div>
      `
      body.appendChild(form)
      form.querySelector('#addNoteBtn').addEventListener('click', ()=>{
        const title = form.querySelector('#noteTitle').value.trim()
        const content = form.querySelector('#noteContent').value.trim()
        if (!title) {
          this.showNotification('Please provide a title.', 'warning')
          return
        }
        this.addNote(title, content); form.querySelector('#noteTitle').value=''; form.querySelector('#noteContent').value=''
        this.openNotes()
      })

      ;(this.book.notes||[]).forEach(n=>{
        const card = document.createElement('div')
        card.className = 'card'
        card.innerHTML = `
          <div class="row between">
            <strong>${n.title}</strong>
            <div class="row">
              <button class="btn" data-a="edit">Edit</button>
              <button class="btn danger" data-a="del">Delete</button>
            </div>
          </div>
          <div class="muted" style="margin-top:6px;white-space:pre-wrap">${n.content||''}</div>
        `
        card.querySelector('[data-a="edit"]').addEventListener('click', ()=>{
          const title = prompt('Note title', n.title); if (title==null) return
          const content = prompt('Content', n.content||''); if (content==null) return
          n.title=title; n.content=content; this.save(); this.openNotes()
        })
        card.querySelector('[data-a="del"]').addEventListener('click', ()=>{
          if (!confirm('Delete note?')) return
          this.book.notes = this.book.notes.filter(x=>x.id!==n.id); this.save(); this.openNotes()
        })
        body.appendChild(card)
      })
      this.openRightPanel()
    }

    // Outline Panel
    openOutline(){
      const body = $('#rpBody'); body.innerHTML = ''
      $('#rpTitle').textContent = 'Outline'
      $('#soundToggleRow').style.display = 'none'
      const outline = this.buildOutline()
      if (!outline.length){
        body.innerHTML = `<div class="card"><div class="muted">Use H1/H2/H3 in the editor (buttons above) to build an outline.</div></div>`
      } else {
        outline.forEach(n=>{
          const item = document.createElement('div')
          item.className = 'card'
          item.style.marginLeft = (n.level-1)*12 + 'px'
          item.style.cursor = 'pointer'
          item.innerHTML = `<strong>${n.text}</strong>`
          item.addEventListener('click', ()=>{
            n.node.scrollIntoView({behavior:'smooth', block:'center'})
          })
          body.appendChild(item)
        })
      }
      this.openRightPanel()
    }
    buildOutline(){
      const ed = $('#editor'); const hs = ed.querySelectorAll('h1, h2, h3')
      return Array.from(hs).map(h=>({ level: parseInt(h.tagName[1],10), text: this.stripHTML(h.innerHTML).trim(), node: h }))
    }

    // Planner
    openPlanner(){
      this.renderPlanner('snowflake')
      this.showModal('#plannerModal')
    }
    renderPlanner(active='snowflake'){
      $$('#plannerModal .tab').forEach(t=>{
        t.classList.toggle('active', t.dataset.tab===active)
        t.onclick = () => this.renderPlanner(t.dataset.tab)
      })
      const root = $('#plannerContent'); root.innerHTML = ''
      if (active==='snowflake') this.renderSnowflake(root)
      if (active==='plot') this.renderPlot(root)
      if (active==='magic') this.renderMagic(root)
      if (active==='world') this.renderWorld(root)
    }
    renderSection(title, help, id, value){
      const wrap = document.createElement('div')
      wrap.className = 'section card'
      wrap.innerHTML = `
        <strong>${title}</strong>
        ${help ? `<div class="muted" style="margin:4px 0 6px">${help}</div>`:''}
        <textarea id="${id}">${value||''}</textarea>
      `
      return wrap
    }
    renderSnowflake(root){
      const S = this.book.planner.snowflake || (this.book.planner.snowflake = {})
      root.appendChild(this.renderSection('Step 1 — One-sentence', 'Your story in 20–30 words.', 'sf1', S.step1))
      root.appendChild(this.renderSection('Step 2 — One-paragraph', 'Five sentences: setup, three disasters, ending.', 'sf2', S.step2))
      root.appendChild(this.renderSection('Step 3 — Character summaries', 'Name, motivation, goal, conflict, epiphany (one per line).', 'sf3', S.step3))
      root.appendChild(this.renderSection('Step 4 — One-page synopsis', '', 'sf4', S.step4))
      root.appendChild(this.renderSection('Step 5 — Scene list (high-level)', 'List 20–40 key scenes or beats (one per line).', 'sf5', S.step5))
      const row = document.createElement('div')
      row.className = 'row end'
      row.innerHTML = `<button class="btn primary" id="saveSnowflakeBtn">Save Snowflake</button><button class="btn" id="exportSnowflakeBtn">Export</button>`
      root.appendChild(row)
      $('#saveSnowflakeBtn').onclick = ()=>{
        this.book.planner.snowflake = {
          step1: $('#sf1').value, step2: $('#sf2').value, step3: $('#sf3').value,
          step4: $('#sf4').value, step5: $('#sf5').value
        }
        this.save(true)
      }
      $('#exportSnowflakeBtn').onclick = ()=>{
        const s = this.book.planner.snowflake
        const md = [
          `# Snowflake — ${this.book.title}`,
          ``,
          `## Step 1 — One-sentence`, s.step1||'', ``,
          `## Step 2 — One-paragraph`, s.step2||'', ``,
          `## Step 3 — Characters`, s.step3||'', ``,
          `## Step 4 — One-page`, s.step4||'', ``,
          `## Step 5 — Scene list`, s.step5||'',
        ].join('\n')
        Store.download(`${this.book.title.replace(/\s+/g,'_')}_snowflake.md`, md, 'text/markdown')
      }
    }
    renderPlot(root){
      const P = this.book.planner.plot || (this.book.planner.plot = {})
      root.appendChild(this.renderSection('Act I — Setup', 'Opening image, theme stated, setup, catalyst', 'plotA1', P.act1))
      root.appendChild(this.renderSection('Act II — Confrontation', 'B-story, fun & games, midpoint, bad guys close in', 'plotA2', P.act2))
      root.appendChild(this.renderSection('Act III — Resolution', 'All is lost, dark night, finale, final image', 'plotA3', P.act3))
      root.appendChild(this.renderSection('Beat list', 'Optional detailed beats (one per line).', 'plotBeats', P.beats))
      const row = document.createElement('div'); row.className='row end'; row.innerHTML = `<button class="btn primary" id="savePlotBtn">Save Plot</button>`
      root.appendChild(row)
      $('#savePlotBtn').onclick = ()=>{
        this.book.planner.plot = { act1: $('#plotA1').value, act2: $('#plotA2').value, act3: $('#plotA3').value, beats: $('#plotBeats').value }
        this.save(true)
      }
    }
    renderMagic(root){
      const M = this.book.planner.magic || (this.book.planner.magic = {})
      root.appendChild(this.renderSection('Rules', 'How does magic work?', 'magicRules', M.rules))
      root.appendChild(this.renderSection('Costs', 'What are the costs and limitations?', 'magicCosts', M.costs))
      root.appendChild(this.renderSection('Sources', 'Where does magic come from?', 'magicSources', M.sources))
      root.appendChild(this.renderSection('Edge cases', 'Loopholes or edge cases?', 'magicEdges', M.edges))
      root.appendChild(this.renderSection('Examples', 'Short examples showing magic in action.', 'magicExamples', M.examples))
      const row = document.createElement('div'); row.className='row end'; row.innerHTML = `<button class="btn primary" id="saveMagicBtn">Save Magic</button>`
      root.appendChild(row)
      $('#saveMagicBtn').onclick = ()=>{
        this.book.planner.magic = {
          rules: $('#magicRules').value, costs: $('#magicCosts').value, sources: $('#magicSources').value,
          edges: $('#magicEdges').value, examples: $('#magicExamples').value
        }
        this.save(true)
      }
    }
    renderWorld(root){
      const W = this.book.planner.world || (this.book.planner.world = {})
      root.appendChild(this.renderSection('Geography', 'Locations, maps, regions', 'worldGeo', W.geo))
      root.appendChild(this.renderSection('Culture', 'Customs, politics, religions', 'worldCulture', W.culture))
      root.appendChild(this.renderSection('Technology', 'Tech level, tools', 'worldTech', W.tech))
      root.appendChild(this.renderSection('History', 'Key events, timeline', 'worldHistory', W.history))
      root.appendChild(this.renderSection('Loose notes', 'Any other world notes', 'worldNotes', W.notes))
      const row = document.createElement('div'); row.className='row end'; row.innerHTML = `<button class="btn primary" id="saveWorldBtn">Save World</button>`
      root.appendChild(row)
      $('#saveWorldBtn').onclick = ()=>{
        this.book.planner.world = {
          geo: $('#worldGeo').value, culture: $('#worldCulture').value, tech: $('#worldTech').value,
          history: $('#worldHistory').value, notes: $('#worldNotes').value
        }
        this.save(true)
      }
    }

    // Library UI
    openLibrary(){ this.renderLibrary(); this.showModal('#libraryModal') }
    renderLibrary(){
      const grid = $('#booksGrid'); grid.innerHTML = ''
      $('#libraryCount').textContent = `${this.library.books.length} book(s)`
      this.library.books.forEach(b=>{
        const card = document.createElement('div')
        card.className = 'book'
        const words = (b.chapters||[]).reduce((s,c)=> s + (c.wordCount||0), 0)
        card.innerHTML = `
          <div class="close" title="Delete">×</div>
          <div class="book-head">
            <div class="cover" style="background:${b.cover||'linear-gradient(135deg,var(--brand),var(--brand-2))'}"></div>
            <div>
              <div class="book-title">${b.title}</div>
              <div class="muted">${b.author||'Unknown'} • ${words.toLocaleString()} words</div>
            </div>
            <div style="margin-left:auto">${b.id===this.library.activeBookId?'<span class="pill">Active</span>':''}</div>
          </div>
          <div class="book-actions">
            <button class="btn" data-act="open">Open</button>
            <button class="btn" data-act="edit">Edit</button>
            <button class="btn" data-act="dup">Duplicate</button>
          </div>
        `
        card.querySelector('.close').addEventListener('click', (e)=>{ e.stopPropagation(); this.deleteBook(b.id) })
        card.querySelector('[data-act="open"]').addEventListener('click', (e)=>{ e.stopPropagation(); this.setActiveBook(b.id) })
        card.querySelector('[data-act="edit"]').addEventListener('click', (e)=>{ e.stopPropagation(); this.openBookModal(b) })
        card.querySelector('[data-act="dup"]').addEventListener('click', (e)=>{ e.stopPropagation(); this.duplicateBook(b.id) })
        grid.appendChild(card)
      })
    }
    openBookModal(book=null){
      $('#bookModalTitle').textContent = book ? 'Edit Book' : 'New Book'
      $('#bookTitle').value = book?.title || ''
      $('#bookAuthor').value = book?.author || ''
      $('#bookGenre').value = book?.genre || ''
      $('#bookGoal').value = book?.goal ?? 50000
      $('#bookLogline').value = book?.logline || ''
      $('#bookTheme').value = book?.theme || 'light'
      $('#bookCover').value = book?.cover || '#5b7cfa'
      $('#saveBookBtn').dataset.editId = book?.id || ''
      this.showModal('#bookModal')
    }
    saveBookFromModal(){
      const payload = {
        title: $('#bookTitle').value.trim(),
        author: $('#bookAuthor').value.trim(),
        genre: $('#bookGenre').value.trim(),
        logline: $('#bookLogline').value.trim(),
        goal: Math.max(0, parseInt($('#bookGoal').value||'0',10)),
        theme: $('#bookTheme').value,
        cover: $('#bookCover').value.trim() || '#5b7cfa'
      }
      const editId = $('#saveBookBtn').dataset.editId
      if (!payload.title){ 
        this.showNotification('Please provide a title.', 'warning')
        return 
      }
      if (editId){
        const b = this.library.books.find(x=>x.id===editId)
        Object.assign(b, payload, {updatedAt: nowISO()})
        if (this.book.id === editId) this.book = b
        Store.save(this.library)
      } else {
        const b = this.createBook(payload)
        if (!b.chapters.length) { b.chapters.push({ id:'ch-'+Date.now(), title:'Chapter 1', content:'', wordCount:0, createdAt:nowISO(), updatedAt:nowISO() }) }
        this.setActiveBook(b.id)
      }
      this.closeModal('#bookModal')
      this.renderLibrary()
      this.renderAll()
    }

    // Export
    openExport(){
      const menu = document.createElement('div')
      Object.assign(menu.style,{
        position:'fixed', right:'14px', top:'70px', background:'var(--bg-2)', border:'1px solid var(--line)', borderRadius:'12px', boxShadow:'var(--shadow)', zIndex:2100, minWidth:'220px'
      })
      ;[
        ['Export as Text (.txt)', ()=> this.exportText()],
        ['Export as HTML (.html)', ()=> this.exportHTML()],
        ['Export as Markdown (.md)', ()=> this.exportMarkdown()],
        ['Print / PDF', ()=> window.print()]
      ].forEach(([label,fn],i)=>{
        const item = document.createElement('div')
        item.textContent = label
        Object.assign(item.style,{padding:'10px 14px',cursor:'pointer', borderBottom: i<3 ? '1px solid var(--line)':''})
        item.addEventListener('click', ()=> { fn(); cleanup() })
        menu.appendChild(item)
      })
      document.body.appendChild(menu)
      const cleanup = ()=> { if (menu.parentNode) menu.parentNode.removeChild(menu); document.removeEventListener('click', cleanup)}
      setTimeout(()=> document.addEventListener('click', cleanup), 0)
    }
    exportText(){
      let s = `# ${this.book.title}\n\n${this.book.logline?this.book.logline+'\n\n':''}`
      this.book.chapters.forEach(ch=>{
        s += `${ch.title}\n\n${this.stripHTML(ch.content)}\n\n`
      })
      Store.download(`${this.book.title.replace(/\s+/g,'_')}.txt`, s, 'text/plain')
    }
    exportHTML(){
      let html = `<!doctype html><html><head><meta charset="utf-8"><title>${this.book.title}</title>
<style>body{font-family:Georgia,serif;max-width:850px;margin:0 auto;padding:40px;line-height:1.7}h1{font-size:28px;border-bottom:2px solid #333;padding-bottom:8px}h2{page-break-before:always}</style>
</head><body><h1>${this.book.title}</h1>${this.book.logline?`<p><em>${this.book.logline}</em></p>`:''}`
      this.book.chapters.forEach(ch=>{
        html += `<h2>${ch.title}</h2><div>${ch.content}</div>`
      })
      html += `</body></html>`
      Store.download(`${this.book.title.replace(/\s+/g,'_')}.html`, html, 'text/html')
    }
    exportMarkdown(){
      let s = `# ${this.book.title}\n\n${this.book.logline?`> ${this.book.logline}\n\n`:''}`
      this.book.chapters.forEach(ch=>{
        s += `## ${ch.title}\n\n${this.stripHTML(ch.content)}\n\n`
      })
      Store.download(`${this.book.title.replace(/\s+/g,'_')}.md`, s, 'text/markdown')
    }

    // Backup
    openBackup(){ this.renderSnapshots(); this.showModal('#backupModal') }
    renderSnapshots(){
      const list = $('#snapshotsList'); list.innerHTML = ''
      ;(this.book.snapshots||[]).forEach(s=>{
        const row = document.createElement('div')
        row.className = 'row between'
        row.innerHTML = `
          <div><strong>${new Date(s.timestamp).toLocaleString()}</strong></div>
          <div class="row">
            <button class="btn" data-a="dl">Download</button>
            <button class="btn" data-a="restore">Restore</button>
            <button class="btn danger" data-a="del">Delete</button>
          </div>
        `
        row.querySelector('[data-a="dl"]').addEventListener('click', ()=>{
          Store.download(`${this.book.title.replace(/\s+/g,'_')}_snapshot_${s.id}.json`, JSON.stringify(s, null, 2), 'application/json')
        })
        row.querySelector('[data-a="restore"]').addEventListener('click', ()=> this.restoreSnapshot(s.id))
        row.querySelector('[data-a="del"]').addEventListener('click', ()=>{
          this.book.snapshots = this.book.snapshots.filter(x=>x.id!==s.id); this.save(); this.renderSnapshots()
        })
        list.appendChild(row)
      })
      if (!list.children.length){
        const none = document.createElement('div'); none.className='muted'; none.textContent='No snapshots yet.'
        list.appendChild(none)
      }
    }
    exportLibraryJSON(){ Store.download('novelcraft_library.json', JSON.stringify(this.library, null, 2), 'application/json') }
    importLibraryJSON(){
      const file = $('#importJSONFile').files[0]
      if (!file){ 
        this.showNotification('Choose a JSON file first.', 'warning')
        return 
      }
      const reader = new FileReader()
      reader.onload = () => {
        try{
          const data = JSON.parse(reader.result)
          if (!data.books){ 
            this.showNotification('Invalid backup format.', 'error')
            return 
          }
          this.library = data
          Store.save(this.library)
          this.book = this.getActiveBook() || this.library.books[0]
          this.renderAll()
          this.showNotification('Library imported successfully!', 'success')
        } catch(e){ 
          this.showNotification('Failed to import: ' + e.message, 'error')
        }
      }
      reader.readAsText(file)
    }

    // Find & Replace
    openFind(){ this.showModal('#findModal'); $('#findText').focus() }
    getEditorText(){ return $('#editor').innerHTML }
    setEditorHTML(html){ $('#editor').innerHTML = html; this.onEditorInput() }
    buildRegExp(){
      const find = $('#findText').value
      if (!find) return null
      const flags = $('#findCase').checked ? 'g' : 'gi'
      const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pat = $('#findWhole').checked ? `\\b${esc}\\b` : esc
      return new RegExp(pat, flags)
    }
    findNext(){
      const re = this.buildRegExp(); if (!re) return
      const sel = window.getSelection()
      const ed = $('#editor')
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null)
      let node, passedAnchor = false
      let anchorNode = sel.rangeCount ? sel.getRangeAt(0).endContainer : null
      while (node = walker.nextNode()){
        if (!passedAnchor && anchorNode && node === anchorNode) { passedAnchor = true; continue }
        const hay = $('#findCase').checked ? node.nodeValue : node.nodeValue.toLowerCase()
        const needle = $('#findCase').checked ? $('#findText').value : $('#findText').value.toLowerCase()
        const idx = hay.indexOf(needle)
        if (idx >= 0){
          const r = document.createRange()
          r.setStart(node, idx); r.setEnd(node, idx + needle.length)
          sel.removeAllRanges(); sel.addRange(r)
          $('#edBody').scrollTo({top: node.parentElement.offsetTop - 120, behavior:'smooth'})
          return
        }
      }
      this.showNotification('No more matches found.', 'info')
    }
    replaceOne(){
      const sel = window.getSelection()
      if (!sel.rangeCount || sel.toString()===''){ this.findNext(); return }
      const replacement = $('#replaceText').value
      document.execCommand('insertText', false, replacement)
      this.onEditorInput()
      this.findNext()
    }
    replaceAll(){
      const re = this.buildRegExp(); if (!re) return
      const text = this.stripHTML(this.getEditorText())
      const replaced = text.replace(re, $('#replaceText').value)
      const htmlOut = replaced.split(/\n{2,}/).map(p=> `<p>${p.replace(/\n/g,'<br>')}</p>`).join('')
      this.setEditorHTML(htmlOut)
      this.showNotification('All occurrences replaced successfully!', 'success')
    }

    // Utility
    promptNewChapter(){
      const t = prompt('New chapter title','Chapter '+(this.book.chapters.length+1))
      if (t!=null) this.addChapter(t||('Chapter '+(this.book.chapters.length+1)))
    }
    save(force=false){
      this.book.updatedAt = nowISO()
      Store.save(this.library)
      if (force) this.showNotification('Book saved successfully!', 'success')
      this.renderStatus()
    }
    autosave(){ setInterval(()=> this.save(), 15000) }
    ticker(){ setInterval(()=> { $('#statusTime').textContent = new Date().toLocaleTimeString() }, 1000) }

    // Modal utils
    showModal(sel){ 
      const modal = $(sel)
      modal.style.display = 'flex'
      // Force reflow to ensure the display change is applied
      modal.offsetHeight
      modal.classList.add('show')
      modal.setAttribute('aria-hidden', 'false')
      // Focus first focusable element after animation
      setTimeout(() => {
        const firstFocusable = modal.querySelector('input, button, textarea, select')
        if (firstFocusable) firstFocusable.focus()
      }, 150)
    }
    closeModal(sel){ 
      const modal = $(sel)
      modal.classList.remove('show')
      modal.setAttribute('aria-hidden', 'true')
      // Hide after animation completes
      setTimeout(() => {
        modal.style.display = 'none'
      }, 300)
    }

    // Notification system
    showNotification(message, type = 'info', duration = 4000) {
      const container = $('#notificationContainer')
      const notification = document.createElement('div')
      notification.className = `notification ${type}`
      
      const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'
      
      notification.innerHTML = `
        <div class="icon">${icon}</div>
        <div class="message">${message}</div>
        <button class="close" aria-label="Close notification">×</button>
      `
      
      const closeBtn = notification.querySelector('.close')
      closeBtn.addEventListener('click', () => this.hideNotification(notification))
      
      container.appendChild(notification)
      
      // Auto-hide after duration
      setTimeout(() => this.hideNotification(notification), duration)
      
      return notification
    }

    hideNotification(notification) {
      if (notification.parentNode) {
        notification.style.animation = 'slideOutRight .2s ease'
        setTimeout(() => notification.remove(), 200)
      }
    }
  }

  // PWA functionality
  class PWAManager {
    constructor() {
      this.deferredPrompt = null
      this.init()
    }

    init() {
      // Register service worker
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js')
            .then(registration => {
              console.log('SW registered: ', registration)
            })
            .catch(registrationError => {
              console.log('SW registration failed: ', registrationError)
            })
        })
      }

      // Listen for the beforeinstallprompt event
      window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault()
        // Stash the event so it can be triggered later
        this.deferredPrompt = e
        // Show our custom install button
        this.showInstallButton()
      })

      // Listen for the app being installed
      window.addEventListener('appinstalled', () => {
        console.log('PWA was installed')
        this.hideInstallButton()
        // Show a notification
        if (window.novelcraft) {
          window.novelcraft.showNotification('NovelCraft installed successfully! 🎉', 'success')
        }
      })
    }

    showInstallButton() {
      // Check if install button already exists
      let installBtn = $('#installPWABtn')
      if (!installBtn) {
        // Create install button
        installBtn = document.createElement('button')
        installBtn.id = 'installPWABtn'
        installBtn.className = 'btn'
        installBtn.innerHTML = '📱 Install App'
        installBtn.title = 'Install NovelCraft as a Progressive Web App'
        installBtn.addEventListener('click', () => this.installPWA())
        
        // Add to topbar
        const topbarRight = $('.topbar .group:last-child')
        if (topbarRight) {
          topbarRight.appendChild(installBtn)
        }
      }
    }

    hideInstallButton() {
      const installBtn = $('#installPWABtn')
      if (installBtn) {
        installBtn.remove()
      }
    }

    async installPWA() {
      if (!this.deferredPrompt) {
        return
      }

      // Show the install prompt
      this.deferredPrompt.prompt()
      
      // Wait for the user to respond to the prompt
      const { outcome } = await this.deferredPrompt.userChoice
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt')
      } else {
        console.log('User dismissed the install prompt')
      }
      
      // Clear the deferredPrompt variable
      this.deferredPrompt = null
      this.hideInstallButton()
    }
  }

  // Instantiate
  const app = new NovelCraft()
  const pwa = new PWAManager()
  window.novelcraft = app
})()
