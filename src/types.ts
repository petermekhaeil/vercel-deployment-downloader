// https://vercel.com/docs/rest-api#interfaces/auth-user
export type AuthUser = {
  username: string;
};

// https://vercel.com/docs/rest-api#interfaces/team
export type Team = {
  name: string;
  id: string;
  membership: {
    role: string;
  };
};

// https://vercel.com/docs/rest-api#endpoints/deployments/list-deployments
export type Deployment = {
  uid: string;
  url: string;
  name: string;
  source?: 'cli' | 'git' | 'import' | 'import/repo' | 'clone/repo';
  target?: ('production' | 'staging') | null;
  inspectorUrl: string | null;
  meta?: { [key: string]: string };
  ready?: number;
};

// https://vercel.com/docs/rest-api#interfaces/file-tree
export type FileTree = {
  name: string;
  type: 'directory' | 'file' | 'symlink' | 'lambda' | 'middleware' | 'invalid';
  uid?: string;
  children?: FileTree[];
  contentType?: string;
  mode: number;
  symlink?: string;
};

// https://vercel.com/docs/rest-api#errors
export type Error = {
  code: string;
  message: string;
};
