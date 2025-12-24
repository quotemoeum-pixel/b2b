// pages/_app.js
import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase';
import '../styles/globals.css';

// 인증 컨텍스트 생성
const AuthContext = createContext();

// 세션 캐시 (페이지 이동 시 불필요한 API 호출 방지)
let cachedUser = null;
let cachedRole = null;
let cachedUserName = null;
let sessionChecked = false;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(cachedUser);
  const [role, setRole] = useState(cachedRole);
  const [userName, setUserName] = useState(cachedUserName);
  const [loading, setLoading] = useState(!sessionChecked);
  const router = useRouter();

  // 사용자 role 및 이름 조회
  const fetchUserProfile = async (userId, email) => {
    // admin 이메일은 무조건 admin
    if (email === 'wd1178@naver.com') {
      return { role: 'admin', name: '관리자' };
    }

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('role, name')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Profile 조회 오류:', error);
        return { role: 'field', name: null };
      }

      return {
        role: data?.role || 'field',
        name: data?.name || null
      };
    } catch (error) {
      console.error('Profile 조회 오류:', error);
      return { role: 'field', name: null };
    }
  };

  useEffect(() => {
    // 이미 세션 확인이 완료된 경우 스킵
    if (sessionChecked) {
      setUser(cachedUser);
      setRole(cachedRole);
      setUserName(cachedUserName);
      setLoading(false);
      return;
    }

    // 현재 세션 확인
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        cachedUser = session?.user ?? null;

        if (cachedUser) {
          const profile = await fetchUserProfile(cachedUser.id, cachedUser.email);
          cachedRole = profile.role;
          cachedUserName = profile.name;
        } else {
          cachedRole = null;
          cachedUserName = null;
        }

        sessionChecked = true;
        setUser(cachedUser);
        setRole(cachedRole);
        setUserName(cachedUserName);
      } catch (error) {
        console.error('세션 확인 오류:', error);
        cachedUser = null;
        cachedRole = null;
        cachedUserName = null;
        sessionChecked = true;
        setUser(null);
        setRole(null);
        setUserName(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // 인증 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        cachedUser = session?.user ?? null;

        if (cachedUser) {
          const profile = await fetchUserProfile(cachedUser.id, cachedUser.email);
          cachedRole = profile.role;
          cachedUserName = profile.name;
        } else {
          cachedRole = null;
          cachedUserName = null;
        }

        sessionChecked = true;
        setUser(cachedUser);
        setRole(cachedRole);
        setUserName(cachedUserName);
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
      cachedUser = null;
      cachedRole = null;
      cachedUserName = null;
      sessionChecked = false;
      setUser(null);
      setRole(null);
      setUserName(null);
      router.push('/login');
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  // role 로딩 중인지 확인 (user는 있는데 role이 아직 null)
  const roleLoading = loading || (!!user && role === null);

  const value = {
    user,
    role,
    userName,
    loading: roleLoading,  // role까지 로드 완료될 때까지 로딩
    login,
    logout,
    signUp,
    isLoggedIn: !!user,
    isAdmin: role === 'admin',
    isOffice: role === 'office',
    isField: role === 'field',
    isPrism: role === 'prism',
    canAccessAllPages: role === 'admin' || role === 'office',
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
