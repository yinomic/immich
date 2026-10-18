import { NotificationLevel, NotificationType } from 'src/enum.js';

export const notificationStub = {
  customEvent: {
    id: 'notification-custom-event',
    type: NotificationType.Custom,
    description: 'A custom notification',
    title: 'Custom Notification',
    createdAt: new Date('2024-01-01'),
    data: { albumId: 'album-id' },
    level: NotificationLevel.Success,
    readAt: null,
  },
};
