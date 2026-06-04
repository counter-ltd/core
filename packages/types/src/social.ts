import type { NotificationType } from '@counter/config';
import type { PublicUser } from './user.ts';
import type { Post } from './post.ts';

export interface Notification {
  id: string;
  type: NotificationType;
  actor: PublicUser;
  post: Post | null;
  read: boolean;
  createdAt: string;
}

export interface TrendingTag {
  name: string;
  postCount: number;
}
