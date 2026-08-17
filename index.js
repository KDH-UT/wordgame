<script>
    const socket = io();

    const questionsDatabase = {
      'example': { label: "예제", word: "김동환", image: "images/example.png" },
      1: { label: "1번", word: "사과", image: "images/q1.png" },
      2: { label: "2번", word: "CIS", image: "images/q2.png" },
      3: { label: "3번", word: "bias", image: "images/q3.png" },
      4: { label: "4번", word: "주석", image: "images/q4.png" },
      5: { label: "5번", word: "산란", image: "images/q5.png" },
      6: { label: "6번", word: "배", image: "images/q6.png" },
      7: { label: "7번", word: "핵", image: "images/q7.png" }
    };

    let selectedQuestionKey = null;
    let currentRoomId = null;
    let isMaster = false;
    let isPhoneHost = false;
    let gameState = {};

    function calculateScore(elapsedSeconds) {
      const maxSeconds = 120;
      if (elapsedSeconds >= maxSeconds) return 0;
      const ratio = 1 - (elapsedSeconds / maxSeconds);
      return Math.max(0, Math.floor(1000 * Math.pow(ratio, 2)));
    }

    function showHostSetup() {
      document.getElementById('view-select').classList.add('hidden');
      document.getElementById('view-host-setup').classList.remove('hidden');
    }

    function showMasterJoinSetup() {
      document.getElementById('view-select').classList.add('hidden');
      document.getElementById('view-master-setup').classList.remove('hidden');
    }

    function showPlayerSetup() {
      document.getElementById('view-select').classList.add('hidden');
      document.getElementById('view-player').classList.remove('hidden');
    }

    function createRoomAsPhone() {
      isPhoneHost = true;
      const count = parseInt(document.getElementById('teams-count').value);
      socket.emit('createRoom', { teamsCount: count });
    }

    socket.on('roomCreated', (data) => {
      currentRoomId = data.roomId;
      gameState = data.gameState;
      document.getElementById('view-host-setup').classList.add('hidden');
      document.getElementById('view-host').classList.remove('hidden');
      document.getElementById('room-code-txt').innerText = `방 코드: ${currentRoomId} (이 코드를 컴퓨터/참가자에게 공유하세요)[cite: 1]`;
      document.getElementById('master-manager-box').classList.remove('hidden');
      renderLeaderboard();
      renderHostGrid();
      renderMasterManagerList({});
    });

    socket.on('updateMasters', (masters) => {
      renderMasterManagerList(masters);
    });

    function renderMasterManagerList(masters) {
      if (!isPhoneHost) return;
      const container = document.getElementById('connected-masters-list');
      const keys = Object.keys(masters || {});
      if (keys.length === 0) {
        container.innerHTML = '<span style="color:#7f8c8d;">접속한 마스터가 없습니다[cite: 1].</span>';
        return;
      }
      let html = '';
      keys.forEach(id => {
        html += `<div style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 5px 8px; border-radius: 4px; margin-bottom: 4px; border: 1px solid #ddd;">
          <span>💻 마스터 (${id.substr(0,6)}...)[cite: 1]</span>
          <button class="btn-danger" style="padding: 2px 6px; font-size: 11px;" onclick="kickMaster('${id}')">퇴출</button>
        </div>`;
      });
      container.innerHTML = html;
    }

    function kickMaster(masterId) {
      socket.emit('kickMaster', { roomId: currentRoomId, masterId });
    }

    function connectAsMaster() {
      const code = document.getElementById('master-room-code').value.trim().toUpperCase();
      if (!code) return alert("방 코드를 입력하세요.");
      currentRoomId = code;
      isMaster = true;
      socket.emit('masterLogin', { roomId: code, masterName: '마스터PC-' + Math.floor(Math.random()*100) });
    }

    socket.on('masterKicked', (msg) => {
      alert(msg);
      location.reload();
    });

    socket.on('masterAck', (data) => {
      gameState = data.gameState;
      document.getElementById('view-master-setup').classList.add('hidden');
      document.getElementById('view-host').classList.remove('hidden');
      document.getElementById('room-code-txt').innerText = `[컴퓨터 마스터 조회 모드] 방 코드: ${currentRoomId}[cite: 1]`;
      
      // 컴퓨터 마스터는 문제 출제 및 시작 조작 버튼 숨김 처리
      document.getElementById('host-control-panel').classList.add('hidden');
      
      renderLeaderboard();
      renderHostGrid();
    });

    socket.on('syncState', (data) => {
      gameState = data.gameState;
      renderLeaderboard();
      renderHostGrid();
    });

    function selectQuestion(qKey) {
      selectedQuestionKey = qKey;
      ['example', 1, 2, 3, 4, 5, 6, 7].forEach(key => {
        const btn = document.getElementById(`q-btn-${key}`);
        if(btn) {
          if (key === qKey) btn.classList.add('selected');
          else btn.classList.remove('selected');
        }
      });
      const qData = questionsDatabase[qKey];
      const preview = document.getElementById('selected-question-preview');
      if(preview) preview.innerText = `선택된 항목 [${qData.label}]: 정답("${qData.word}")[cite: 1]`;
    }

    function toggleAllowTeamSwitch() {
      socket.emit('toggleSwitch', { roomId: currentRoomId });
    }

    function startRound() {
      if (!selectedQuestionKey) return alert("문제를 먼저 선택하세요!");
      const isSpyEnabled = document.getElementById('enable-spy-opt').checked;
      const qData = questionsDatabase[selectedQuestionKey];
      socket.emit('startRound', { roomId: currentRoomId, qKey: selectedQuestionKey, isSpyEnabled, qData });
    }

    function revealHintsToGuessers() {
      socket.emit('revealHints', { roomId: currentRoomId });
      alert("각 조별로 힌트와 정답 입력 화면이 공개되고 타이머가 시작되었습니다![cite: 1]");
    }

    function selectTeam(teamNum, btnElement) {
      selectedTeam = teamNum;
      document.querySelectorAll('.btn-team-select').forEach(b => b.classList.remove('active'));
      btnElement.classList.add('active');
      document.getElementById('btn-join-final').disabled = false;
    }

    let selectedTeam = null;
    let isTimerStarted = false;
    let scoreTimerInterval = null;
    let timerStartTime = null;

    function connectRoom() {
      const code = document.getElementById('room-code').value.trim().toUpperCase();
      const name = document.getElementById('nickname').value.trim();
      if (!code || !name) return alert("방 코드와 이름을 모두 입력하세요.");
      currentRoomId = code;
      socket.emit('getRoomInfo', { roomId: code, isChanging: false });
    }

    socket.on('errorMsg', (msg) => { alert(msg); });

    socket.on('roomInfo', (data) => {
      if (data.isChanging && !data.allowSwitch) {
        return alert("현재 호스트가 조 변경을 허용하지 않았습니다!");
      }
    
      document.getElementById('player-step1').classList.add('hidden');
      document.getElementById('player-step2').classList.remove('hidden');
      document.getElementById('player-game').classList.add('hidden');
      renderTeamSelectButtons(data.teamsCount, data.teamCounts);
    });

    socket.on('leaderboardUpdate', (data) => {
      renderPlayerLeaderboard(data.teamsCount, data.teamScores);
    });

    socket.on('joinAck', (data) => {
      document.getElementById('player-step2').classList.add('hidden');
      document.getElementById('player-game').classList.remove('hidden');
      document.getElementById('my-info').innerText = `${data.name}님 (${data.team}조)[cite: 1]`;
      document.getElementById('role-badge').innerText = "호스트가 라운드를 시작하길 기다리는 중...[cite: 1]";
    });

    socket.on('roundStart', (data) => {
      isTimerStarted = false;
      stopLiveScoreTimer();
      document.getElementById('ui-giver').classList.add('hidden');
      document.getElementById('ui-guesser').classList.add('hidden');
      document.getElementById('live-score-box').classList.add('hidden');
      document.getElementById('hint-input').value = '';
      document.getElementById('answer-input').value = '';
      document.getElementById('hint-msg').innerText = '';
      document.getElementById('result-score-txt').innerText = '';
      document.getElementById('hints-list').innerHTML = '';
      document.getElementById('hint-btn').disabled = false;
      document.getElementById('ans-btn').disabled = true;

      if (data.isSpy) document.getElementById('spy-alert-box').classList.remove('hidden');
      else document.getElementById('spy-alert-box').classList.add('hidden');

      if (data.isGuesser) {
        document.getElementById('role-badge').innerText = "🎯 당신은 문제를 맞추는 사람입니다![cite: 1]";
      } else {
        document.getElementById('role-badge').innerText = "💡 힌트를 작성해 주세요![cite: 1]";
        document.getElementById('given-word').innerText = data.word;
        const imgContainer = document.getElementById('given-image-container');
        if (data.image) imgContainer.innerHTML = `<img src="${data.image}" alt="문제 이미지" class="hint-image">`;
        else imgContainer.innerHTML = '';
        document.getElementById('ui-giver').classList.remove('hidden');
      }
    });

    socket.on('hintsRevealed', (data) => {
      isTimerStarted = true;
      timerStartTime = data.startTime || Date.now();
      
      document.getElementById('ui-guesser').classList.remove('hidden');
      
      const list = document.getElementById('hints-list');
      const myTeamHints = data.teamHints || [];
      list.innerHTML = myTeamHints.map(h => `<div style="padding: 6px; margin: 5px 0; background: #fff; border: 1px solid #ddd; border-radius: 6px; font-weight:bold; color:#2980b9;">• ${h}</div>`).join('') || '<i>제출된 힌트가 없습니다[cite: 1].</i>';
      
      document.getElementById('ans-btn').disabled = false;
      startLiveScoreTimer();
    });

    socket.on('hintRejected', () => {
      document.getElementById('hint-msg').style.color = '#d9534f';
      document.getElementById('hint-msg').innerText = "⚠️ 힌트가 반려되었습니다. 다시 입력해주세요![cite: 1]";
      document.getElementById('hint-input').value = '';
      document.getElementById('hint-btn').disabled = false;
    });

    socket.on('answerAutoCorrect', (data) => {
      stopLiveScoreTimer();
      document.getElementById('result-score-txt').style.color = '#27ae60';
      document.getElementById('result-score-txt').innerText = `🎉 정답입니다! (+${data.score}점)[cite: 1]`;
    });

    socket.on('answerPending', () => {
      stopLiveScoreTimer();
      document.getElementById('result-score-txt').style.color = '#e67e22';
      document.getElementById('result-score-txt').innerText = "정답 제출 완료 (호스트 검수 대기 중)[cite: 1]";
    });

    socket.on('answerApproved', (data) => {
      stopLiveScoreTimer();
      document.getElementById('result-score-txt').style.color = '#27ae60';
      document.getElementById('result-score-txt').innerText = `🎉 정답 승인됨! (+${data.score}점)[cite: 1]`;
    });

    socket.on('answerRejected', () => {
      stopLiveScoreTimer();
      document.getElementById('result-score-txt').style.color = '#d9534f';
      document.getElementById('result-score-txt').innerText = "⚠️ 오답 처리되었습니다[cite: 1].";
      if (isTimerStarted) { document.getElementById('ans-btn').disabled = false; startLiveScoreTimer(); }
    });

    function startLiveScoreTimer() {
      stopLiveScoreTimer();
      const scoreBox = document.getElementById('live-score-box');
      const scoreVal = document.getElementById('live-score-val');
      scoreBox.classList.remove('hidden');
      scoreTimerInterval = setInterval(() => {
        if (!timerStartTime) return;
        const elapsed = (Date.now() - timerStartTime) / 1000;
        const currentScore = calculateScore(elapsed);
        scoreVal.innerText = currentScore;
        if (currentScore <= 0) stopLiveScoreTimer();
      }, 50);
    }

    function stopLiveScoreTimer() {
      if (scoreTimerInterval) { clearInterval(scoreTimerInterval); scoreTimerInterval = null; }
    }

    function renderPlayerLeaderboard(count, scores) {
      const board = document.getElementById('player-leaderboard');
      if (!board) return;
      board.innerHTML = '';
      for (let i = 1; i <= count; i++) {
        board.innerHTML += `<div class="leaderboard-item">${i}조: <span>${scores[i] || 0}점</span></div>`;
      }
    }

    function renderTeamSelectButtons(count, teamCounts) {
      const container = document.getElementById('team-select-buttons');
      container.innerHTML = '';
      for (let i = 1; i <= count; i++) {
        const btn = document.createElement('button');
        btn.className = 'btn-team-select';
        btn.innerText = `${i}조 (${teamCounts[i] || 0}명)`;
        btn.onclick = () => selectTeam(i, btn);
        container.append(btn);
      }
    }

    function joinSelectedTeam() {
      if (!selectedTeam) return alert("조를 선택하세요!");
      const name = document.getElementById('nickname').value.trim();
      socket.emit('joinTeam', { roomId: currentRoomId, team: selectedTeam, name });
    }

    function requestTeamChange() {
      socket.emit('getRoomInfo', { roomId: currentRoomId, isChanging: true });
    }

    function sendHint() {
      const hint = document.getElementById('hint-input').value.trim();
      if (!hint) return alert("힌트를 입력하세요.");
      if (hint.split(/\s+/).length > 2) return alert("힌트는 최대 2단어까지만 가능합니다!");
      socket.emit('submitHint', { roomId: currentRoomId, hint });
      document.getElementById('hint-msg').style.color = '#2ECC71';
      document.getElementById('hint-msg').innerText = "힌트 전송 완료 (대기 중)[cite: 1]";
    }

    function sendAnswer() {
      if (!isTimerStarted) return alert("타이머가 시작되지 않았습니다.");
      const ans = document.getElementById('answer-input').value.trim();
      if (!ans) return alert("정답을 입력하세요.");
      const elapsed = (Date.now() - timerStartTime) / 1000;
      const score = calculateScore(elapsed);
      socket.emit('submitAnswer', { roomId: currentRoomId, answer: ans, score });
      document.getElementById('ans-btn').disabled = true;
      stopLiveScoreTimer();
    }

    function approveAnswer(playerId) { socket.emit('approveAnswer', { roomId: currentRoomId, playerId }); }
    function rejectAnswer(playerId) { socket.emit('rejectAnswer', { roomId: currentRoomId, playerId }); }
    function approveHint(playerId) { socket.emit('approveHint', { roomId: currentRoomId, playerId }); }
    function rejectHint(playerId) { socket.emit('rejectHint', { roomId: currentRoomId, playerId }); }
    function toggleHistoryStatus(teamNum, historyId) { socket.emit('toggleHistoryStatus', { roomId: currentRoomId, teamNum, historyId }); openHistoryModal(teamNum); }

    function renderLeaderboard() {
      const board = document.getElementById('leaderboard');
      if(!board) return;
      board.innerHTML = '';
      for (let i = 1; i <= gameState.teamsCount; i++) {
        const score = gameState.teamScores[i] || 0;
        board.innerHTML += `<div class="leaderboard-item clickable" onclick="openHistoryModal(${i})">${i}조: <span>${score}점</span></div>`;
      }
    }

    function openHistoryModal(teamNum) {
      document.getElementById('modal-title').innerText = `📋 ${teamNum}조 정/오답 제출 이력`;
      const listContainer = document.getElementById('modal-history-list');
      const histories = gameState.teamHistories[teamNum] || [];
      if (histories.length === 0) {
        listContainer.innerHTML = '<p style="color:#7f8c8d; padding:20px 0; text-align:center;">제출 이력이 없습니다[cite: 1].</p>';
      } else {
        let html = '';
        histories.slice().reverse().forEach(h => {
          const statusTxt = h.isCorrect ? `<strong style="color:#2ECC71;">[정답] (+${h.score}점)</strong>` : `<strong style="color:#d9534f;">[오답/대기]</strong>`;
          const btnTxt = h.isCorrect ? '오답으로 변경' : '정답으로 변경';
          const btnClass = h.isCorrect ? 'btn-danger' : 'btn-approve';
          html += `
            <div class="history-item">
              <div>
                <small style="color:#7f8c8d;">${h.timestamp} | [*]: ${h.playerName}</small><br>
                제시어: <strong>${h.targetWord}</strong> / 제출: <strong>${h.submittedAnswer}</strong><br>
                상태: ${statusTxt}
              </div>
              <div><button class="${btnClass}" onclick="toggleHistoryStatus(${teamNum}, '${h.id}')">${btnTxt}</button></div>
            </div>`;
        });
        listContainer.innerHTML = html;
      }
      document.getElementById('history-modal').classList.remove('hidden');
    }

    function closeHistoryModal() { document.getElementById('history-modal').classList.add('hidden'); }

    function renderHostGrid() {
      const grid = document.getElementById('teams-grid');
      if(!grid) return;
      grid.innerHTML = '';
      for (let i = 1; i <= gameState.teamsCount; i++) {
        const members = gameState.teams[i] || [];
        const teamTotal = gameState.teamScores[i] || 0;
        let html = `<div class="team-card"><h4><span>${i}조 (${members.length}명)</span><small style="color:#2ECC71;">총 ${teamTotal}점</small></h4>`;
        members.forEach(id => {
          const p = gameState.players[id];
          if (p) {
            const role = p.isGuesser ? ' <span class="guesser">[*]</span>' : '';
            const spyBadge = p.isSpy ? ` <span class="spy-badge">스파이🕵️</span>` : '';
            const spyClass = p.isSpy ? ' spy-highlight' : '';
            const timeTxt = p.hintDuration ? `<span class="time-badge">(${p.hintDuration}초)</span>` : '';
            let hintTxt = '';
            if (p.hint) {
              const statusClass = p.isApproved ? 'hint-badge approved' : 'hint-badge';
              const statusLabel = p.isApproved ? '[승인됨]' : '[대기중]';
              let actionBtns = '';
              if (!p.isApproved) actionBtns = `<button class="btn-approve" onclick="approveHint('${id}')">승인</button>`;
              actionBtns += `<button class="btn-danger" onclick="rejectHint('${id}')">반려</button>`;
              hintTxt = `<br><span class="${statusClass}">${statusLabel} ${p.hint}</span> ${actionBtns}`;
            }
            let ansTxt = '';
            if (p.answer) {
              if (p.isCorrect) {
                ansTxt = `<br><small style="color:#27ae60; font-weight:bold;">정답 승인됨: ${p.answer} (+${p.pendingScore}점)</small> <button class="btn-danger" onclick="rejectAnswer('${id}')">오답 처리</button>`;
              } else {
                ansTxt = `<br><small style="color:#e67e22; font-weight:bold;">제출 정답: ${p.answer} (대기점수: ${p.pendingScore}점)</small> <button class="btn-approve" onclick="approveAnswer('${id}')">정답 처리</button> <button class="btn-danger" onclick="rejectAnswer('${id}')">오답 처리</button>`;
              }
            }
            html += `<div class="player-item${spyClass}">• ${p.name}${timeTxt}${role}${spyBadge}${hintTxt}${ansTxt}</div>`;
          }
        });
        html += `</div>`;
        grid.innerHTML += html;
      }
    }
  </script>
