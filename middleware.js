// middleware.js 비활성화
export function middleware() {
    // 미들웨어 비활성화 - 아무 작업도 하지 않음
    return;
  }
  
  // 이 설정은 미들웨어를 실행하지 않도록 합니다
  export const config = {
    matcher: [],
  };