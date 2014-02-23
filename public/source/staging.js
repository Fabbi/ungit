
var ko = require('knockout');
var ProgressBarViewModel = require('./controls').ProgressBarViewModel;
var screens = require('./screens');
var dialogs = require('./dialogs');
var inherits = require('util').inherits;

var StagingViewModel = function(repository) {
  var self = this;
  this.repository = repository;
  this.app =repository.app;
  this.repoPath = this.repository.repoPath;
  this.filesByPath = {};
  this.files = ko.observable([]);
  this.commitMessageTitle = ko.observable();
  this.commitMessageBody = ko.observable();
  this.inRebase = ko.observable(false);
  this.inMerge = ko.observable(false);
  this.allStageFlag = ko.observable(false);
  this.commitButtonVisible = ko.computed(function() {
    return !self.inRebase() && !self.inMerge();
  });
  this.nFiles = ko.computed(function() {
    return self.files().length;
  });
  this.nStagedFiles = ko.computed(function() {
    return self.files().filter(function(f) { return f.staged(); }).length;
  });
  this.stats = ko.computed(function() {
    return self.nFiles() + ' files, ' + self.nStagedFiles() + ' to be commited';
  });
  this.amend = ko.observable(false);
  this.canAmend = ko.computed(function() {
    return self.repository.graph.HEAD() && !self.inRebase() && !self.inMerge();
  });
  this.canStashAll = ko.computed(function() {
    return !self.amend();
  });
  this.showNux = ko.computed(function() {
    return self.files().length == 0 && !self.amend() && !self.inRebase();
  });
  this.committingProgressBar = new ProgressBarViewModel('committing-' + repository.repoPath);
  this.rebaseContinueProgressBar = new ProgressBarViewModel('rebase-continue-' + repository.repoPath);
  this.rebaseAbortProgressBar = new ProgressBarViewModel('rebase-abort-' + repository.repoPath);
  this.mergeContinueProgressBar = new ProgressBarViewModel('merge-continue-' + repository.repoPath);
  this.mergeAbortProgressBar = new ProgressBarViewModel('merge-abort-' + repository.repoPath);
  this.stashProgressBar = new ProgressBarViewModel('stash-' + repository.repoPath);
  this.commitValidationError = ko.computed(function() {
    if (!self.amend() && !self.files().some(function(file) { return file.staged(); }))
      return "No files to commit";

    if (self.files().some(function(file) { return file.conflict(); }))
      return "Files in conflict";

    if (!self.commitMessageTitle() && !self.inRebase()) return "Provide a title";
    return "";
  });
  this.toggleSelectAllGlyphClass = ko.computed(function() {
    if (self.allStageFlag()) return 'glyphicon-unchecked';
    else return 'glyphicon-check';
  });
}
exports.StagingViewModel = StagingViewModel;
StagingViewModel.prototype.refreshContent = function(callback) {
  var self = this;
  this.app.get('/status', { path: this.repoPath }, function(err, status) {
    if (err) {
      if (callback) callback(err);
      return err.errorCode == 'must-be-in-working-tree';
    }
    self.setFiles(status.files);
    self.inRebase(!!status.inRebase);
    self.inMerge(!!status.inMerge);
    if (status.inMerge) {
      var lines = status.commitMessage.split('\n');
      self.commitMessageTitle(lines[0]);
      self.commitMessageBody(lines.slice(1).join('\n'));
    }
    if (callback) callback();
  });
}
StagingViewModel.prototype.setFiles = function(files) {
  var self = this;
  var newFiles = [];
  for(var file in files) {
    var fileViewModel = this.filesByPath[file];
    if (!fileViewModel) {
      this.filesByPath[file] = fileViewModel = new FileViewModel(self, files[file].type);
      fileViewModel.name(file);
    }
    fileViewModel.isNew(files[file].isNew);
    fileViewModel.removed(files[file].removed);
    fileViewModel.conflict(files[file].conflict);
    fileViewModel.invalidateDiff();
    newFiles.push(fileViewModel);
  }
  this.files(newFiles);
}
StagingViewModel.prototype.toogleAmend = function() {
  if (!this.amend() && !this.commitMessageTitle()) {
    this.commitMessageTitle(this.repository.graph.HEAD().title());
    this.commitMessageBody(this.repository.graph.HEAD().body());
  }
  else if(this.amend()) {
    var isPrevDefaultMsg =
      this.commitMessageTitle() == this.repository.graph.HEAD().title() &&
      this.commitMessageBody() == this.repository.graph.HEAD().body();
    if (isPrevDefaultMsg) {
      this.commitMessageTitle('');
      this.commitMessageBody('');
    }
  }
  this.amend(!this.amend());
}
StagingViewModel.prototype.commit = function() {
  var self = this;
  this.committingProgressBar.start();
  var files = this.files().filter(function(file) {
    return file.staged();
  }).map(function(file) {
    return file.name();
  });
  var commitMessage = this.commitMessageTitle();
  if (this.commitMessageBody()) commitMessage += '\n\n' + this.commitMessageBody();
  this.app.post('/commit', { path: this.repository.repoPath, message: commitMessage, files: files, amend: this.amend() }, function(err, res) {
    if (err) {
      if (err.errorCode == 'no-git-name-email-configured') {
        self.repository.app.content(new screens.UserErrorViewModel({
          title: 'Git email and/or name not configured',
          details: 'You need to configure your git email and username to commit files.<br> Run <code>git config --global user.name "your name"</code> and <code>git config --global user.email "your@email.com"</code>'
        }));
        return true;
      }
      return;
    }
    self.commitMessageTitle('');
    self.commitMessageBody('');
    self.amend(false);
    self.files([]);
    self.committingProgressBar.stop();
  });
}
StagingViewModel.prototype.rebaseContinue = function() {
  var self = this;
  this.rebaseContinueProgressBar.start();
  this.app.post('/rebase/continue', { path: this.repository.repoPath }, function(err, res) {
    self.rebaseContinueProgressBar.stop();
  });
}
StagingViewModel.prototype.rebaseAbort = function() {
  var self = this;
  this.rebaseAbortProgressBar.start();
  this.app.post('/rebase/abort', { path: this.repository.repoPath }, function(err, res) {
    self.rebaseAbortProgressBar.stop();
  });
}
StagingViewModel.prototype.mergeContinue = function() {
  var self = this;
  this.mergeContinueProgressBar.start();
  var commitMessage = this.commitMessageTitle();
  if (this.commitMessageBody()) commitMessage += '\n\n' + this.commitMessageBody();
  this.app.post('/merge/continue', { path: this.repository.repoPath, message: commitMessage }, function(err, res) {
    self.mergeContinueProgressBar.stop();
  });
}
StagingViewModel.prototype.mergeAbort = function() {
  var self = this;
  this.mergeAbortProgressBar.start();
  this.app.post('/merge/abort', { path: this.repository.repoPath }, function(err, res) {
    self.mergeAbortProgressBar.stop();
  });
}
StagingViewModel.prototype.invalidateFilesDiffs = function() {
  this.files().forEach(function(file) {
    file.invalidateDiff(false);
  });
}
StagingViewModel.prototype.discardAllChanges = function() {
  var self = this;
  var diag = new dialogs.YesNoDialogViewModel('Are you sure you want to discard all changes?', 'This operation cannot be undone.');
  diag.closed.add(function() {
    if (diag.result()) self.app.post('/discardchanges', { path: self.repository.repoPath, all: true });
  });
  this.app.showDialog(diag);
}
StagingViewModel.prototype.stashAll = function() {
  var self = this;
  this.stashProgressBar.start();
  this.app.post('/stashes', { path: this.repository.repoPath, message: this.commitMessageTitle() }, function(err, res) {
    self.stashProgressBar.stop();
  });
}
StagingViewModel.prototype.toogleAllStages = function() {
  var self = this;
  for (var n in self.files()){
    self.files()[n].staged(self.allStageFlag());
  }

  self.allStageFlag(!self.allStageFlag());
}

var FileViewModel = function(staging, type) {
  var self = this;
  this.staging = staging;
  this.app = staging.app;
  this.type = type;
  this.templateName = type == 'image' ? 'imageFileDiff' : 'textFileDiff';
  this.staged = ko.observable(true);
  this.name = ko.observable();
  this.isNew = ko.observable(false);
  this.removed = ko.observable(false);
  this.conflict = ko.observable(false);
  this.showingDiffs = ko.observable(false);
  this.addedLines = ko.observable();
  this.deletedLines = ko.observable();
  this.diffsProgressBar = new ProgressBarViewModel('diffs-' + this.staging.repository.repoPath);
  this.diff = type == 'image' ? new ImageDiffViewModel(this) : new LineByLineDiffViewModel(this);
}
exports.FileViewModel = FileViewModel;
FileViewModel.prototype.toogleStaged = function() {
  this.staged(!this.staged());
}
FileViewModel.prototype.discardChanges = function() {
  this.app.post('/discardchanges', { path: this.staging.repository.repoPath, file: this.name() });
}
FileViewModel.prototype.ignoreFile = function() {
  var self = this;
  this.app.post('/ignorefile', { path: this.staging.repository.repoPath, file: this.name() }, function(err) {
    if (err && err.errorCode == 'file-already-git-ignored') {
      // The file was already in the .gitignore, so force an update of the staging area (to hopefull clear away this file)
      self.app.workingTreeChanged();
      return true;
    }
  });
}
FileViewModel.prototype.resolveConflict = function() {
  this.app.post('/resolveconflicts', { path: this.staging.repository.repoPath, files: [this.name()] });
}
FileViewModel.prototype.toogleDiffs = function() {
  var self = this;
  if (this.showingDiffs()) this.showingDiffs(false);
  else {
    this.showingDiffs(true);
    this.invalidateDiff(true);
  }
}
FileViewModel.prototype.toggleDiffsNoInvalidate = function () {
  this.showingDiffs(!this.showingDiffs());
}
FileViewModel.prototype.invalidateDiff = function(drawProgressBar) {
  if (this.showingDiffs() && (drawProgressBar || this.type != 'image'))
    this.diff.invalidateDiff(drawProgressBar);
}

var LineByLineDiffViewModel = function(fileViewModel) {
  this.fileViewModel = fileViewModel;
  this.diffs = ko.observable();
}
LineByLineDiffViewModel.prototype.invalidateDiff = function(drawProgressBar) {
  var self = this;

  if (drawProgressBar) self.fileViewModel.diffsProgressBar.start();
  var isTextType = self.fileViewModel.type == 'text';
  self.fileViewModel.app.get('/diff', { file: self.fileViewModel.name(), path: self.fileViewModel.staging.repository.repoPath}, function(err, diffs) {
    if (drawProgressBar) self.fileViewModel.diffsProgressBar.stop();
    if (err) {
      if (err.errorCode == 'no-such-file') {
        // The file existed before but has been removed, but we're trying to get a diff for it
        // Most likely it will just disappear with the next refresh of the staging area
        // so we just ignore the error here
        return true;
      }
      return;
    }
    var newDiffs = [];
    diffs.forEach(function(diff) {
      diff.lines.forEach(
        function(line) {
          newDiffs.push({
            oldLineNumber: line[0],
            newLineNumber: line[1],
            added: line[2][0] == '+',
            removed: line[2][0] == '-' || line[2][0] == '\\',
            text: line[2]
          });
        }
      );
    });
    self.diffs(newDiffs);
  });
}

var ImageDiffViewModel = function(fileViewModel) {
  this.fileViewModel = fileViewModel;
  this.state = ko.computed(function() {
    if (fileViewModel.isNew()) return 'new';
    if (fileViewModel.removed()) return 'removed';
    return 'changed';
  });
  this.oldImageSrc = ko.computed(function() {
    return '/api/diff/image?path=' + encodeURIComponent(fileViewModel.staging.repoPath) + '&filename=' + fileViewModel.name() + '&version=previous';
  });
  this.newImageSrc = ko.computed(function() {
    return '/api/diff/image?path=' + encodeURIComponent(fileViewModel.staging.repoPath) + '&filename=' + fileViewModel.name() + '&version=current';
  });
}
ImageDiffViewModel.prototype.invalidateDiff = function(drawProgressBar) {
}


