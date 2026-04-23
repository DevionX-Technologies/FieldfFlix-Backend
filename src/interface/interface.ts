export interface IFmcNotification {
  notification: { title: string; body: string };
  token: string;
  data: {
    click_action: string;
  };
}

export interface IStatusMessage {
  status: number;
  message: string;
  type: string;
}
