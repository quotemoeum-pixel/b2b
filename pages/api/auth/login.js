// pages/api/auth/login.js
export default function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const { password } = req.body;
    
    // 환경 변수에서 비밀번호 가져오기
    const correctPassword = process.env.APP_PASSWORD;
    
    if (!correctPassword) {
      console.error('환경 변수에 비밀번호가 설정되지 않았습니다.');
      return res.status(500).json({ success: false, error: '서버 설정 오류' });
    }
    
    if (password === correctPassword) {
      return res.status(200).json({ success: true });
    } else {
      return res.status(401).json({ success: false, error: '비밀번호가 일치하지 않습니다.' });
    }
  }