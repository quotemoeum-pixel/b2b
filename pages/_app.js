// pages/_app.js
import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase';
import '../styles/globals.css';

// 인증 컨텍스트 생성
const AuthContext = createContext();

// 세션 캐시 (페이지 이동 시 불필요한 API 호출 방지)
let cachedUser = null;
let sessionChecked = false;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(cachedUser);
  const [loading, setLoading] = useState(!sessionChecked);
  const router = useRouter();

  useEffect(() => {
    // 이미 세션 확인이 완료된 경우 스킵
    if (sessionChecked) {
      setUser(cachedUser);
      setLoading(false);
      return;
    }

    // 현재 세션 확인
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        cachedUser = session?.user ?? null;
        sessionChecked = true;
        setUser(cachedUser);
      } catch (error) {
        console.error('세션 확인 오류:', error);
        cachedUser = null;
        sessionChecked = true;
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // 인증 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        cachedUser = session?.user ?? null;
        sessionChecked = true;
        setUser(cachedUser);
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // 회원가입 함수
  const signUp = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // 이메일 인증 없이 바로 로그인 가능하도록
          emailRedirectTo: undefined
        }
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, user: data.user };
    } catch (error) {
      console.error('회원가입 오류:', error);
      return { success: false, error: '회원가입 처리 중 오류가 발생했습니다.' };
    }
  };

  // 로그인 함수
  const login = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, user: data.user };
    } catch (error) {
      console.error('로그인 오류:', error);
      return { success: false, error: '로그인 처리 중 오류가 발생했습니다.' };
    }
  };

  // 로그아웃 함수
  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      router.push('/login');
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  const value = {
    user,
    loading,
    login,
    logout,
    signUp,
    isLoggedIn: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// 인증 컨텍스트 사용을 위한 훅
export function useAuth() {
  return useContext(AuthContext);
}

// _app.js의 메인 컴포넌트
function MyApp({ Component, pageProps }) {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
}

export default MyApp;
