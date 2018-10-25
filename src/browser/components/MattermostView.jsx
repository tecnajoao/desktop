/* eslint-disable react/no-set-state */
// setState() is necessary for this component
import url from 'url';

import React from 'react';
import PropTypes from 'prop-types';
import createReactClass from 'create-react-class';
import {findDOMNode} from 'react-dom';
import {ipcRenderer, remote, shell} from 'electron';

import contextMenu from '../js/contextMenu';
import {protocols} from '../../../electron-builder.json';
const scheme = protocols[0].schemes[0];

import ErrorView from './ErrorView.jsx';

const preloadJS = `file://${remote.app.getAppPath()}/browser/webview/mattermost_bundle.js`;

const ERR_NOT_IMPLEMENTED = -11;
const U2F_EXTENSION_URL = 'chrome-extension://kmendfapggjehodndflmmgagdbamhnfd/u2f-comms.html';

const MattermostView = createReactClass({
  propTypes: {
    name: PropTypes.string,
    id: PropTypes.string,
    onTargetURLChange: PropTypes.func,
    onUnreadCountChange: PropTypes.func,
    src: PropTypes.string,
    active: PropTypes.bool,
    withTab: PropTypes.bool,
    useSpellChecker: PropTypes.bool,
    onSelectSpellCheckerLocale: PropTypes.func,
  },

  getInitialState() {
    return {
      errorInfo: null,
      isContextMenuAdded: false,
      reloadTimeoutID: null,
      isLoaded: false,
    };
  },

  handleUnreadCountChange(unreadCount, mentionCount, isUnread, isMentioned) {
    if (this.props.onUnreadCountChange) {
      this.props.onUnreadCountChange(unreadCount, mentionCount, isUnread, isMentioned);
    }
  },

  componentDidMount() {
    var self = this;
    var webview = findDOMNode(this.refs.webview);

    webview.addEventListener('did-fail-load', (e) => {
      console.log(self.props.name, 'webview did-fail-load', e);
      if (e.errorCode === -3) { // An operation was aborted (due to user action).
        return;
      }
      if (e.errorCode === ERR_NOT_IMPLEMENTED && e.validatedURL === U2F_EXTENSION_URL) {
        // U2F device is not supported, but the guest page should fall back to PIN code in 2FA.
        // https://github.com/mattermost/desktop/issues/708
        return;
      }

      self.setState({
        errorInfo: e,
        isLoaded: true,
      });
      function reload() {
        window.removeEventListener('online', reload);
        self.reload();
      }
      if (navigator.onLine) {
        self.setState({
          reloadTimeoutID: setTimeout(reload, 30000),
        });
      } else {
        window.addEventListener('online', reload);
      }
    });

    // Open link in browserWindow. for exmaple, attached files.
    webview.addEventListener('new-window', (e) => {
      var currentURL = url.parse(webview.getURL());
      var destURL = url.parse(e.url);
      if (destURL.protocol !== 'http:' && destURL.protocol !== 'https:' && destURL.protocol !== `${scheme}:`) {
        ipcRenderer.send('confirm-protocol', destURL.protocol, e.url);
        return;
      }

      if (currentURL.host === destURL.host) {
        if (destURL.path.match(/^\/api\/v[3-4]\/public\/files\//)) {
          ipcRenderer.send('download-url', e.url);
        } else {
          // New window should disable nodeIntergration.
          window.open(e.url, remote.app.getName(), 'nodeIntegration=no, show=yes');
        }
      } else {
        // if the link is external, use default browser.
        shell.openExternal(e.url);
      }
    });

    // 'dom-ready' means "content has been loaded"
    // So this would be emitted again when reloading a webview
    webview.addEventListener('dom-ready', () => {
      // webview.openDevTools();

      if (!this.state.isContextMenuAdded) {
        contextMenu.setup(webview, {
          useSpellChecker: this.props.useSpellChecker,
          onSelectSpellCheckerLocale: (locale) => {
            if (this.props.onSelectSpellCheckerLocale) {
              this.props.onSelectSpellCheckerLocale(locale);
            }
            webview.send('set-spellcheker');
          },
        });
        this.setState({isContextMenuAdded: true});
      }
    });

    webview.addEventListener('update-target-url', (event) => {
      if (self.props.onTargetURLChange) {
        self.props.onTargetURLChange(event.url);
      }
    });

    webview.addEventListener('ipc-message', (event) => {
      switch (event.channel) {
      case 'onGuestInitialized':
        self.setState({
          isLoaded: true,
        });
        break;
      case 'onUnreadCountChange':
        var unreadCount = event.args[0];
        var mentionCount = event.args[1];

        // isUnread and isMentioned is pulse flag.
        var isUnread = event.args[2];
        var isMentioned = event.args[3];
        self.handleUnreadCountChange(unreadCount, mentionCount, isUnread, isMentioned);
        break;
      case 'onNotificationClick':
        self.props.onNotificationClick();
        break;
      }
    });

    webview.addEventListener('page-title-updated', (event) => {
      if (self.props.active) {
        ipcRenderer.send('update-title', {
          title: event.title,
        });
      }
    });

    webview.addEventListener('console-message', (e) => {
      const message = `[${this.props.name}] ${e.message}`;
      switch (e.level) {
      case 0:
        console.log(message);
        break;
      case 1:
        console.warn(message);
        break;
      case 2:
        console.error(message);
        break;
      default:
        console.log(message);
        break;
      }
    });
  },

  reload() {
    clearTimeout(this.state.reloadTimeoutID);
    this.setState({
      errorInfo: null,
      reloadTimeoutID: null,
      isLoaded: false,
    });
    var webview = findDOMNode(this.refs.webview);
    webview.reload();
  },

  clearCacheAndReload() {
    this.setState({
      errorInfo: null,
    });
    var webContents = findDOMNode(this.refs.webview).getWebContents();
    webContents.session.clearCache(() => {
      webContents.reload();
    });
  },

  focusOnWebView() {
    const webview = findDOMNode(this.refs.webview);
    const webContents = webview.getWebContents(); // webContents might not be created yet.
    if (webContents && !webContents.isFocused()) {
      webview.focus();
      webContents.focus();
    }
  },

  canGoBack() {
    const webview = findDOMNode(this.refs.webview);
    return webview.getWebContents().canGoBack();
  },

  canGoForward() {
    const webview = findDOMNode(this.refs.webview);
    return webview.getWebContents().canGoForward();
  },

  goBack() {
    const webview = findDOMNode(this.refs.webview);
    webview.getWebContents().goBack();
  },

  goForward() {
    const webview = findDOMNode(this.refs.webview);
    webview.getWebContents().goForward();
  },

  getSrc() {
    const webview = findDOMNode(this.refs.webview);
    return webview.src;
  },

  handleDeepLink(relativeUrl) {
    const webview = findDOMNode(this.refs.webview);
    webview.executeJavaScript(
      'history.pushState(null, null, "' + relativeUrl + '");'
    );
    webview.executeJavaScript(
      'dispatchEvent(new PopStateEvent("popstate", null));'
    );
  },

  render() {
    const errorView = this.state.errorInfo ? (
      <ErrorView
        id={this.props.id + '-fail'}
        className='errorView'
        errorInfo={this.state.errorInfo}
        active={this.props.active}
        withTab={this.props.withTab}
      />) : null;

    // Need to keep webview mounted when failed to load.
    const classNames = ['mattermostView'];
    if (this.props.withTab) {
      classNames.push('mattermostView-with-tab');
    }
    if (!this.props.active || this.state.errorInfo) {
      classNames.push('mattermostView-hidden');
    }

    const loadingImage = !this.state.errorInfo && this.props.active && !this.state.isLoaded ? (
      <div className='mattermostView-loadingScreen'>
        <img
          className='mattermostView-loadingImage'
          src='../assets/loading.gif'
          srcSet='../assets/loading.gif 1x, ../assets/loading@2x.gif 2x'
        />
      </div>
    ) : null;

    return (
      <div
        className={classNames.join(' ')}
      >
        { errorView }
        <webview
          id={this.props.id}
          preload={preloadJS}
          src={this.props.src}
          ref='webview'
        />
        { loadingImage }
      </div>);
  },
});

export default MattermostView;
