let shouldStop = false;
let port = null;
let totalDeletedCount = 0;
let baseDelay = 300;

chrome.runtime.onConnect.addListener(function (p) {
  port = p;
  console.log("Connected to popup");
  port.onMessage.addListener(function (msg) {
    if (msg.action === "deleteMessages") {
      shouldStop = false;
      totalDeletedCount = 0;
      baseDelay = 300;
      chrome.storage.sync.get(["token", "channel"], function (result) {
        if (!result.token || !result.channel) {
          port.postMessage({
            type: "complete",
            message: "Please set all required fields in the settings.",
          });
          return;
        }
        fetchAndDeleteMessages(result.token, result.channel, null, "");
      });
    } else if (msg.action === "stopDelete") {
      shouldStop = true;
    }
  });
});

async function fetchAndDeleteMessages(token, channel, threadTs, cursor) {
  const baseUrl = "https://slack.com/api/";
  const historyApiUrl = `${baseUrl}conversations.history?channel=${channel}&count=1000`;
  const repliesApiUrl = `${baseUrl}conversations.replies?channel=${channel}&ts=`;
  const deleteApiUrl = `${baseUrl}chat.delete`;

  async function apiRequest(url, method = "GET", data = null) {
    const options = {
      method: method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (data) {
      options.body = JSON.stringify(data);
    }
    const response = await fetch(url, options);
    return await response.json();
  }

  async function deleteMessage(message, threadTs) {
    if (shouldStop) return false;

    const response = await apiRequest(deleteApiUrl, "POST", {
      channel: channel,
      ts: message.ts,
    });

    if (response.ok) {
      console.log(message.ts + (threadTs ? " reply" : "") + " deleted!");
      totalDeletedCount++;
      if (port) {
        port.postMessage({ type: "progress", count: totalDeletedCount });
      }
      return true;
    } else {
      console.log(
        message.ts + " could not be deleted! (" + response.error + ")"
      );
      if (response.error === "ratelimited") {
        const retryAfter = parseInt(
          response.headers.get("Retry-After") || "60"
        );
        baseDelay = Math.max(baseDelay, retryAfter * 1000);
        if (port) {
          port.postMessage({
            type: "rateLimit",
            delay: Math.ceil(baseDelay / 1000),
            count: totalDeletedCount,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, baseDelay));
        return false;
      }
    }
    return true;
  }

  async function deleteMessages(threadTs, messages) {
    for (const message of messages) {
      if (shouldStop) return;

      if (message.thread_ts !== threadTs) {
        // Fetch and delete replies for this thread
        await fetchAndDeleteMessages(token, channel, message.thread_ts, "");
      } else {
        let deleted = false;
        while (!deleted) {
          deleted = await deleteMessage(message, threadTs);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, baseDelay));
    }
  }

  try {
    if (shouldStop) {
      if (port) {
        port.postMessage({
          type: "complete",
          message: `Deletion stopped. Total deleted: ${totalDeletedCount} messages.`,
        });
      }
      return;
    }

    const url = threadTs
      ? repliesApiUrl + threadTs + "&cursor=" + cursor
      : historyApiUrl + "&cursor=" + cursor;
    const response = await apiRequest(url);

    if (!response.ok) {
      throw new Error(response.error);
    }

    if (!response.messages || response.messages.length === 0) {
      if (port) {
        port.postMessage({
          type: "complete",
          message: `No more messages found. Total deleted: ${totalDeletedCount} messages.`,
        });
      }
      return;
    }

    await deleteMessages(threadTs, response.messages);

    if (response.has_more && !shouldStop) {
      await fetchAndDeleteMessages(
        token,
        channel,
        threadTs,
        response.response_metadata.next_cursor
      );
    } else {
      if (port) {
        port.postMessage({
          type: "complete",
          message: `Deletion ${
            shouldStop ? "stopped" : "completed"
          }. Total deleted: ${totalDeletedCount} messages.`,
        });
      }
    }
  } catch (error) {
    if (port) {
      port.postMessage({
        type: "complete",
        message: `Error: ${error.message}`,
      });
    }
  }
}
