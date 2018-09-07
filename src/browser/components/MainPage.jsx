// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import url from 'url';

import React from 'react';
import PropTypes from 'prop-types';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {Grid, Row} from 'react-bootstrap';

import {ipcRenderer, remote} from 'electron';

import Utils from '../../utils/util.js';

import LoginModal from './LoginModal.jsx';
import MattermostView from './MattermostView.jsx';
import TabBar from './TabBar.jsx';
import HoveringURL from './HoveringURL.jsx';
import PermissionRequestDialog from './PermissionRequestDialog.jsx';
import Finder from './Finder.jsx';
import NewTeamModal from './NewTeamModal.jsx';

export default class MainPage extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      unreadCounts: new Array(this.props.teams.length),
      mentionCounts: new Array(this.props.teams.length),
      unreadAtActive: new Array(this.props.teams.length),
      mentionAtActiveCounts: new Array(this.props.teams.length),
      loginQueue: [],
      targetURL: '',
    };

    this.activateFinder = this.activateFinder.bind(this);
    this.addServer = this.addServer.bind(this);
    this.closeFinder = this.closeFinder.bind(this);
    this.focusOnWebView = this.focusOnWebView.bind(this);
    this.handleLogin = this.handleLogin.bind(this);
    this.handleLoginCancel = this.handleLoginCancel.bind(this);
    this.handleOnTeamFocused = this.handleOnTeamFocused.bind(this);
    this.handleSelect = this.handleSelect.bind(this);
    this.handleTargetURLChange = this.handleTargetURLChange.bind(this);
    this.handleUnreadCountChange = this.handleUnreadCountChange.bind(this);
    this.handleUnreadCountTotalChange = this.handleUnreadCountTotalChange.bind(this);
    this.inputBlur = this.inputBlur.bind(this);
    this.markReadAtActive = this.markReadAtActive.bind(this);
  }

  componentDidMount() {
    const self = this;
    ipcRenderer.on('login-request', (event, request, authInfo) => {
      self.setState({
        loginRequired: true,
      });
      const loginQueue = self.state.loginQueue;
      loginQueue.push({
        request,
        authInfo,
      });
      self.setState({
        loginQueue,
      });
    });

    // can't switch tabs sequencially for some reason...
    ipcRenderer.on('switch-tab', (event, key) => {
      this.handleSelect(key);
    });
    ipcRenderer.on('select-next-tab', () => {
      this.handleSelect(this.props.tabIndex + 1);
    });
    ipcRenderer.on('select-previous-tab', () => {
      this.handleSelect(this.props.tabIndex - 1);
    });

    // reload the activated tab
    ipcRenderer.on('reload-tab', () => {
      this.refs[`mattermostView${this.props.tabIndex}`].reload();
    });
    ipcRenderer.on('clear-cache-and-reload-tab', () => {
      this.refs[`mattermostView${this.props.tabIndex}`].clearCacheAndReload();
    });

    function focusListener() {
      self.handleOnTeamFocused(self.props.tabIndex);
      self.refs[`mattermostView${self.props.tabIndex}`].focusOnWebView();
    }

    const currentWindow = remote.getCurrentWindow();
    currentWindow.on('focus', focusListener);
    window.addEventListener('beforeunload', () => {
      currentWindow.removeListener('focus', focusListener);
    });

    // https://github.com/mattermost/desktop/pull/371#issuecomment-263072803
    currentWindow.webContents.on('devtools-closed', () => {
      focusListener();
    });

    //goBack and goForward
    ipcRenderer.on('go-back', () => {
      const mattermost = self.refs[`mattermostView${self.props.tabIndex}`];
      if (mattermost.canGoBack()) {
        mattermost.goBack();
      }
    });

    ipcRenderer.on('go-forward', () => {
      const mattermost = self.refs[`mattermostView${self.props.tabIndex}`];
      if (mattermost.canGoForward()) {
        mattermost.goForward();
      }
    });

    ipcRenderer.on('add-server', () => {
      this.addServer();
    });

    ipcRenderer.on('focus-on-webview', () => {
      this.focusOnWebView();
    });

    ipcRenderer.on('protocol-deeplink', (event, deepLinkUrl) => {
      const lastUrlDomain = Utils.getDomain(deepLinkUrl);
      for (let i = 0; i < this.props.teams.length; i++) {
        if (lastUrlDomain === Utils.getDomain(self.refs[`mattermostView${i}`].getSrc())) {
          if (this.props.tabIndex !== i) {
            this.handleSelect(i);
          }
          self.refs[`mattermostView${i}`].handleDeepLink(deepLinkUrl.replace(lastUrlDomain, ''));
          break;
        }
      }
    });

    ipcRenderer.on('toggle-find', () => {
      this.activateFinder(true);
    });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.tabIndex !== this.props.tabIndex) { // i.e. When tab has been changed
      this.refs[`mattermostView${this.props.tabIndex}`].focusOnWebView();
    }
  }

  handleSelect(tabIndex) {
    const newTabIndex = (this.props.teams.length + tabIndex) % this.props.teams.length;
    this.setState({
      finderVisible: false,
    });

    const webview = document.getElementById('mattermostView' + newTabIndex);
    if (webview) {
      ipcRenderer.send('update-title', {
        title: webview.getTitle(),
      });
    }
    this.handleOnTeamFocused(newTabIndex);
    this.props.onChangeTabIndex(newTabIndex);
  }

  handleUnreadCountChange(index, unreadCount, mentionCount, isUnread, isMentioned) {
    const unreadCounts = this.state.unreadCounts;
    const mentionCounts = this.state.mentionCounts;
    const unreadAtActive = this.state.unreadAtActive;
    const mentionAtActiveCounts = this.state.mentionAtActiveCounts;
    unreadCounts[index] = unreadCount;
    mentionCounts[index] = mentionCount;

    // Never turn on the unreadAtActive flag at current focused tab.
    if (this.props.tabIndex !== index || !remote.getCurrentWindow().isFocused()) {
      unreadAtActive[index] = unreadAtActive[index] || isUnread;
      if (isMentioned) {
        mentionAtActiveCounts[index]++;
      }
    }
    this.setState({
      unreadCounts,
      mentionCounts,
      unreadAtActive,
      mentionAtActiveCounts,
    });
    this.handleUnreadCountTotalChange();
  }

  markReadAtActive(index) {
    const unreadAtActive = this.state.unreadAtActive;
    const mentionAtActiveCounts = this.state.mentionAtActiveCounts;
    unreadAtActive[index] = false;
    mentionAtActiveCounts[index] = 0;
    this.setState({
      unreadAtActive,
      mentionAtActiveCounts,
    });
    this.handleUnreadCountTotalChange();
  }

  handleUnreadCountTotalChange() {
    if (this.props.onUnreadCountChange) {
      let allUnreadCount = this.state.unreadCounts.reduce((prev, curr) => {
        return prev + curr;
      }, 0);
      this.state.unreadAtActive.forEach((state) => {
        if (state) {
          allUnreadCount += 1;
        }
      });
      let allMentionCount = this.state.mentionCounts.reduce((prev, curr) => {
        return prev + curr;
      }, 0);
      this.state.mentionAtActiveCounts.forEach((count) => {
        allMentionCount += count;
      });
      this.props.onUnreadCountChange(allUnreadCount, allMentionCount);
    }
  }

  handleOnTeamFocused(index) {
    // Turn off the flag to indicate whether unread message of active channel contains at current tab.
    this.markReadAtActive(index);
  }

  handleLogin(request, username, password) {
    ipcRenderer.send('login-credentials', request, username, password);
    const loginQueue = this.state.loginQueue;
    loginQueue.shift();
    this.setState({loginQueue});
  }

  handleLoginCancel() {
    const loginQueue = this.state.loginQueue;
    loginQueue.shift();
    this.setState({loginQueue});
  }

  handleTargetURLChange(targetURL) {
    clearTimeout(this.targetURLDisappearTimeout);
    if (targetURL === '') {
      // set delay to avoid momentary disappearance when hovering over multiple links
      this.targetURLDisappearTimeout = setTimeout(() => {
        this.setState({targetURL: ''});
      }, 500);
    } else {
      this.setState({targetURL});
    }
  }

  addServer() {
    this.setState({
      showNewTeamModal: true,
    });
  }

  focusOnWebView(e) {
    if (e.target.className !== 'finder-input') {
      this.refs[`mattermostView${this.props.tabIndex}`].focusOnWebView();
    }
  }

  activateFinder() {
    this.setState({
      finderVisible: true,
      focusFinder: true,
    });
  }

  closeFinder() {
    this.setState({
      finderVisible: false,
    });
  }

  inputBlur() {
    this.setState({
      focusFinder: false,
    });
  }

  render() {
    const self = this;
    let tabsRow;
    if (this.props.teams.length > 1) {
      tabsRow = (
        <Row>
          <TabBar
            id='tabBar'
            teams={this.props.teams}
            unreadCounts={this.state.unreadCounts}
            mentionCounts={this.state.mentionCounts}
            unreadAtActive={this.state.unreadAtActive}
            mentionAtActiveCounts={this.state.mentionAtActiveCounts}
            activeKey={this.props.tabIndex}
            onSelect={this.handleSelect}
            onAddServer={this.addServer}
            showAddServerButton={this.props.showAddServerButton}
            requestingPermission={this.props.requestingPermission}
            onClickPermissionDialog={this.props.onClickPermissionDialog}
          />
        </Row>
      );
    }

    const views = this.props.teams.map((team, index) => {
      function handleUnreadCountChange(unreadCount, mentionCount, isUnread, isMentioned) {
        self.handleUnreadCountChange(index, unreadCount, mentionCount, isUnread, isMentioned);
      }
      function handleNotificationClick() {
        self.handleSelect(index);
      }
      const id = 'mattermostView' + index;
      const isActive = self.props.tabIndex === index;

      let teamUrl = team.url;
      const deeplinkingUrl = this.props.deeplinkingUrl;
      if (deeplinkingUrl !== null && deeplinkingUrl.includes(teamUrl)) {
        teamUrl = deeplinkingUrl;
      }

      return (
        <MattermostView
          key={id}
          id={id}
          withTab={this.props.teams.length > 1}
          useSpellChecker={this.props.useSpellChecker}
          onSelectSpellCheckerLocale={this.props.onSelectSpellCheckerLocale}
          src={teamUrl}
          name={team.name}
          onTargetURLChange={self.handleTargetURLChange}
          onUnreadCountChange={handleUnreadCountChange}
          onNotificationClick={handleNotificationClick}
          ref={id}
          active={isActive}
        />);
    });
    const viewsRow = (
      <Row>
        {views}
      </Row>);

    let request = null;
    let authServerURL = null;
    let authInfo = null;
    if (this.state.loginQueue.length !== 0) {
      request = this.state.loginQueue[0].request;
      const tmpURL = url.parse(this.state.loginQueue[0].request.url);
      authServerURL = `${tmpURL.protocol}//${tmpURL.host}`;
      authInfo = this.state.loginQueue[0].authInfo;
    }
    const modal = (
      <NewTeamModal
        show={this.state.showNewTeamModal}
        onClose={() => {
          this.setState({
            showNewTeamModal: false,
          });
        }}
        onSave={(newTeam) => {
          this.setState({
            showNewTeamModal: false,
          });
          const newTeams = this.props.teams.concat(newTeam);
          this.props.onTeamConfigChange(newTeams);
          this.handleSelect(newTeams.length - 1);
        }}
      />
    );
    return (
      <div
        className='MainPage'
        onClick={this.focusOnWebView}
      >
        <LoginModal
          show={this.state.loginQueue.length !== 0}
          request={request}
          authInfo={authInfo}
          authServerURL={authServerURL}
          onLogin={this.handleLogin}
          onCancel={this.handleLoginCancel}
        />
        {this.props.teams.length === 1 && this.props.requestingPermission[0] ? // eslint-disable-line multiline-ternary
          <PermissionRequestDialog
            id='MainPage-permissionDialog'
            placement='bottom'
            {...this.props.requestingPermission[0]}
            onClickAllow={this.props.onClickPermissionDialog.bind(null, 0, 'allow')}
            onClickBlock={this.props.onClickPermissionDialog.bind(null, 0, 'block')}
            onClickClose={this.props.onClickPermissionDialog.bind(null, 0, 'close')}
          /> : null
        }
        <Grid fluid={true}>
          { tabsRow }
          { viewsRow }
          { this.state.finderVisible ? (
            <Finder
              webviewKey={this.props.tabIndex}
              close={this.closeFinder}
              focusState={this.state.focusFinder}
              inputBlur={this.inputBlur}
            />
          ) : null}
        </Grid>
        <TransitionGroup>
          { (this.state.targetURL === '') ?
            null :
            <CSSTransition
              classNames='hovering'
              timeout={{enter: 300, exit: 500}}
            >
              <HoveringURL
                key='hoveringURL'
                targetURL={this.state.targetURL}
              />
            </CSSTransition>
          }
        </TransitionGroup>
        <div>
          { modal }
        </div>
      </div>
    );
  }
}

MainPage.propTypes = {
  onUnreadCountChange: PropTypes.func.isRequired,
  teams: PropTypes.array.isRequired,
  onTeamConfigChange: PropTypes.func.isRequired,
  tabIndex: PropTypes.number.isRequired,
  onChangeTabIndex: PropTypes.func,
  useSpellChecker: PropTypes.bool.isRequired,
  onSelectSpellCheckerLocale: PropTypes.func.isRequired,
  deeplinkingUrl: PropTypes.string,
  showAddServerButton: PropTypes.bool.isRequired,
  requestingPermission: TabBar.propTypes.requestingPermission,
  onClickPermissionDialog: PropTypes.func,
};

export function determineInitialIndex(teamURLs, deeplinkingUrl) {
  if (deeplinkingUrl === null) {
    return 0;
  }
  const index = teamURLs.findIndex((teamURL) => deeplinkingUrl.includes(teamURL));
  if (index === -1) {
    return 0;
  }
  return index;
}
